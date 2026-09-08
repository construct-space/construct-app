//! Browser host launcher for the in-app `browser-main` window.
//!
//! This module owns one dedicated browser window backed by its own lightweight
//! Vue entrypoint (`frontend/browser.html`). It stays separate from the main
//! Construct shell while reusing the same Tauri process and Rust commands.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    Emitter, Listener, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const BROWSER_WINDOW_LABEL: &str = "browser-main";
const BROWSER_WINDOW_TITLE: &str = "Construct Browser";
pub const DEFAULT_BROWSER_URL: &str = "https://construct.space";
pub const BROWSER_COMMAND_EVENT: &str = "browser:open-url";
pub const BROWSER_TAB_PATCH_EVENT: &str = "browser:tab-patched";
pub const BROWSER_PAGE_STATE_EVENT: &str = "browser:page-state";
pub const BROWSER_POPUP_EVENT: &str = "browser:open-popup";
pub const BROWSER_LINK_CONTEXT_EVENT: &str = "browser:link-context";
pub const BROWSER_PAGE_CONTEXT_EVENT: &str = "browser:page-context";
pub const BROWSER_LOADING_EVENT: &str = "browser:loading";
pub const BROWSER_ENSURE_PAGE_BRIDGE_EVENT: &str = "browser:ensure-page-bridge";
const CONSTRUCT_TAURI_IPC_SCRIPT_TEMPLATE: &str = include_str!("construct_ipc.js");
const BROWSER_PAGE_BRIDGE_SCRIPT_TEMPLATE: &str = include_str!("browser_page_bridge.js");

#[derive(Clone, Default)]
pub struct BrowserTabState {
    pub webview_label: Option<String>,
    pub url: String,
    pub title: String,
}

/// Shared tab state used by `browser_bridge.rs` for operator automation.
#[derive(Default)]
pub struct BrowserState {
    pub tabs: HashMap<String, BrowserTabState>,
    pub active_tab_id: Option<String>,
}

pub type SharedBrowserState = Arc<Mutex<BrowserState>>;

pub fn new_state() -> SharedBrowserState {
    Arc::new(Mutex::new(BrowserState::default()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCommandPayload {
    pub command: String,
    pub mode: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub tab_id: Option<String>,
    pub target: Option<String>,
}

impl BrowserCommandPayload {
    pub fn open(mode: Option<String>, url: Option<String>, title: Option<String>) -> Self {
        Self {
            command: "open".to_string(),
            mode: normalize_mode(mode),
            url: non_empty(url),
            title: non_empty(title),
            tab_id: None,
            target: None,
        }
    }

    pub fn new_tab(url: Option<String>, title: Option<String>, tab_id: String) -> Self {
        Self {
            command: "open".to_string(),
            mode: "browser".to_string(),
            url: non_empty(url),
            title: non_empty(title),
            tab_id: Some(tab_id),
            target: Some("new-tab".to_string()),
        }
    }

    pub fn navigate_tab(tab_id: String, url: Option<String>, title: Option<String>) -> Self {
        Self {
            command: "open".to_string(),
            mode: "browser".to_string(),
            url: non_empty(url),
            title: non_empty(title),
            tab_id: Some(tab_id),
            target: Some("tab".to_string()),
        }
    }

    pub fn close_tab(tab_id: String) -> Self {
        Self {
            command: "close".to_string(),
            mode: "browser".to_string(),
            url: None,
            title: None,
            tab_id: Some(tab_id),
            target: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabPatchPayload {
    pub tab_id: String,
    pub url: String,
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSyncTabPayload {
    pub id: String,
    pub webview_label: Option<String>,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserEnsurePageBridgePayload {
    tab_id: String,
    webview_label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPopupPayload {
    pub tab_id: String,
    pub webview_label: String,
    pub url: String,
    pub popup_id: Option<String>,
    pub target: Option<String>,
    pub via: Option<String>,
    pub foreground: Option<bool>,
}

fn normalize_mode(mode: Option<String>) -> String {
    match mode.as_deref() {
        Some("preview") => "preview".to_string(),
        Some("space-preview") => "space-preview".to_string(),
        _ => "browser".to_string(),
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn build_browser_page_bridge_script(tab_id: &str, webview_label: &str) -> String {
    BROWSER_PAGE_BRIDGE_SCRIPT_TEMPLATE
        .replace("__TAB_ID__", &json_string(tab_id))
        .replace("__WEBVIEW_LABEL__", &json_string(webview_label))
        .replace("__STATE_EVENT__", &json_string(BROWSER_PAGE_STATE_EVENT))
        .replace("__POPUP_EVENT__", &json_string(BROWSER_POPUP_EVENT))
        .replace(
            "__LINK_CONTEXT_EVENT__",
            &json_string(BROWSER_LINK_CONTEXT_EVENT),
        )
        .replace(
            "__PAGE_CONTEXT_EVENT__",
            &json_string(BROWSER_PAGE_CONTEXT_EVENT),
        )
        .replace("__LOADING_EVENT__", &json_string(BROWSER_LOADING_EVENT))
}

pub(crate) fn build_construct_tauri_ipc_script(app: &tauri::AppHandle) -> String {
    CONSTRUCT_TAURI_IPC_SCRIPT_TEMPLATE
        .replace("__CONSTRUCT_INVOKE_KEY__", &json_string(app.invoke_key()))
}

pub fn install_event_listeners(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    app.listen_any(BROWSER_ENSURE_PAGE_BRIDGE_EVENT, move |event| {
        let Ok(payload) = serde_json::from_str::<BrowserEnsurePageBridgePayload>(event.payload())
        else {
            return;
        };

        let tab_id = payload.tab_id.trim();
        let label = payload.webview_label.trim();
        if tab_id.is_empty() || label.is_empty() {
            return;
        }

        let Some(webview) = app_handle.get_webview(label) else {
            return;
        };

        let script = format!(
            "{}\n{}",
            build_construct_tauri_ipc_script(&app_handle),
            build_browser_page_bridge_script(tab_id, label)
        );
        let _ = webview.eval(&script);
    });
}

fn browser_app_path(payload: &BrowserCommandPayload) -> String {
    let mut query = vec![
        format!("command={}", urlencoding::encode(&payload.command)),
        format!("mode={}", urlencoding::encode(&payload.mode)),
    ];

    if let Some(url) = payload.url.as_deref() {
        query.push(format!("url={}", urlencoding::encode(url)));
    }
    if let Some(title) = payload.title.as_deref() {
        query.push(format!("title={}", urlencoding::encode(title)));
    }
    if let Some(tab_id) = payload.tab_id.as_deref() {
        query.push(format!("tabId={}", urlencoding::encode(tab_id)));
    }
    if let Some(target) = payload.target.as_deref() {
        query.push(format!("target={}", urlencoding::encode(target)));
    }

    format!("browser.html?{}", query.join("&"))
}

fn build_browser_window(
    app: &tauri::AppHandle,
    payload: &BrowserCommandPayload,
) -> Result<WebviewWindow, String> {
    let path = browser_app_path(payload);
    let window_title = payload.title.as_deref().unwrap_or(BROWSER_WINDOW_TITLE);

    let builder =
        WebviewWindowBuilder::new(app, BROWSER_WINDOW_LABEL, WebviewUrl::App(path.into()))
            .title(window_title)
            .inner_size(1200.0, 820.0)
            .min_inner_size(900.0, 560.0)
            .resizable(true)
            .fullscreen(false);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    let window = builder
        .build()
        .map_err(|err| format!("failed to open browser window: {err}"))?;

    #[cfg(target_os = "macos")]
    {
        crate::platform::apply_window_vibrancy(&window);
    }

    Ok(window)
}

pub(crate) fn emit_browser_command(
    app: &tauri::AppHandle,
    payload: &BrowserCommandPayload,
) -> Result<(), String> {
    app.emit_to(BROWSER_WINDOW_LABEL, BROWSER_COMMAND_EVENT, payload)
        .map_err(|err| format!("failed to emit browser command: {err}"))
}

pub(crate) fn emit_browser_tab_patch(
    app: &tauri::AppHandle,
    payload: &BrowserTabPatchPayload,
) -> Result<(), String> {
    app.emit_to(BROWSER_WINDOW_LABEL, BROWSER_TAB_PATCH_EVENT, payload)
        .map_err(|err| format!("failed to emit browser tab patch: {err}"))
}

pub(crate) async fn dispatch_browser_command(
    app: &tauri::AppHandle,
    payload: BrowserCommandPayload,
) -> Result<String, String> {
    if let Some(window) = app.get_webview_window(BROWSER_WINDOW_LABEL) {
        if let Some(title) = payload.title.as_deref() {
            let _ = window.set_title(title);
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        emit_browser_command(app, &payload)?;
        return Ok(BROWSER_WINDOW_LABEL.to_string());
    }

    if payload.command == "close" {
        return Err("browser-main is not open".to_string());
    }

    build_browser_window(app, &payload)?;
    Ok(BROWSER_WINDOW_LABEL.to_string())
}

pub(crate) fn open_new_browser_tab(
    app: tauri::AppHandle,
    url: Option<String>,
    title: Option<String>,
    tab_id_prefix: &str,
) {
    let next_url = non_empty(url).unwrap_or_else(|| DEFAULT_BROWSER_URL.to_string());
    let tab_id = format!(
        "{}-{}",
        tab_id_prefix,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let payload = BrowserCommandPayload::new_tab(Some(next_url), title, tab_id);

    tauri::async_runtime::spawn(async move {
        if let Err(error) = dispatch_browser_command(&app, payload).await {
            eprintln!("[browser-main] open_new_browser_tab failed: {}", error);
        }
    });
}

#[tauri::command]
pub fn browser_sync_state(
    state: tauri::State<SharedBrowserState>,
    tabs: Vec<BrowserSyncTabPayload>,
    active_tab_id: Option<String>,
) -> Result<(), String> {
    let mut guard = state
        .lock()
        .map_err(|_| "Browser state lock poisoned".to_string())?;

    guard.tabs.clear();
    for tab in tabs {
        guard.tabs.insert(
            tab.id,
            BrowserTabState {
                webview_label: non_empty(tab.webview_label),
                url: tab.url,
                title: tab.title,
            },
        );
    }
    guard.active_tab_id = non_empty(active_tab_id);

    Ok(())
}

#[tauri::command]
pub fn browser_eval_webview(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    webview_label: String,
    script: String,
) -> Result<(), String> {
    if window.label() != BROWSER_WINDOW_LABEL {
        return Err("browser_eval_webview is only available to the browser window".to_string());
    }
    let label = webview_label.trim();
    if label.is_empty() {
        return Err("webview_label is required".to_string());
    }
    if !label.starts_with("tab-") {
        return Err("webview_label is not a browser tab".to_string());
    }
    if script.trim().is_empty() {
        return Err("script is required".to_string());
    }

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview not found: {}", label))?;

    webview
        .eval(&script)
        .map_err(|err| format!("failed to eval in webview {}: {}", label, err))
}

#[tauri::command]
pub fn browser_build_init_script(
    app: tauri::AppHandle,
    tab_id: String,
    webview_label: String,
) -> Result<String, String> {
    let ipc = build_construct_tauri_ipc_script(&app);
    let bridge = build_browser_page_bridge_script(&tab_id, &webview_label);
    Ok(format!("{}\n{}", ipc, bridge))
}

fn browser_webview_url(raw: &str) -> Result<WebviewUrl, String> {
    let url = raw.trim();
    if url.is_empty() {
        return Err("url is required".to_string());
    }

    Url::parse(url)
        .map(WebviewUrl::External)
        .map_err(|err| format!("invalid browser webview URL {url:?}: {err}"))
}

fn native_new_window_popup_payload(
    tab_id: &str,
    webview_label: &str,
    url: &Url,
) -> BrowserPopupPayload {
    BrowserPopupPayload {
        tab_id: tab_id.to_string(),
        webview_label: webview_label.to_string(),
        url: url.to_string(),
        popup_id: None,
        target: Some("_blank".to_string()),
        via: Some("target-blank".to_string()),
        foreground: Some(true),
    }
}

#[tauri::command]
pub fn browser_create_webview(
    app: tauri::AppHandle,
    window_label: Option<String>,
    tab_id: String,
    webview_label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let tab_id = tab_id.trim();
    let label = webview_label.trim();
    if tab_id.is_empty() {
        return Err("tab_id is required".to_string());
    }
    if label.is_empty() {
        return Err("webview_label is required".to_string());
    }
    if width <= 0.0 || height <= 0.0 {
        return Err("webview bounds must be positive".to_string());
    }

    // Attach the child to the CALLING browser window. Preview windows are
    // `browser-<nonce>`, the standalone browser is `browser-main`; hardcoding
    // the latter left preview windows blank. Restrict to browser/preview
    // windows so this can't reparent arbitrary app windows.
    let parent = window_label
        .as_deref()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .unwrap_or(BROWSER_WINDOW_LABEL);
    if !(parent.starts_with("browser-") || parent.starts_with("preview-web-")) {
        return Err(format!("refusing to host browser webview in window {parent}"));
    }

    let window = app
        .get_window(parent)
        .ok_or_else(|| format!("browser window not found: {}", parent))?;
    let init_script =
        browser_build_init_script(app.clone(), tab_id.to_string(), label.to_string())?;
    let popup_app = app.clone();
    let popup_tab_id = tab_id.to_string();
    let popup_label = label.to_string();
    let builder = WebviewBuilder::new(label, browser_webview_url(&url)?)
        .initialization_script(init_script)
        .on_new_window(move |url, _features| {
            let payload = native_new_window_popup_payload(&popup_tab_id, &popup_label, &url);
            let _ = popup_app.emit(BROWSER_POPUP_EVENT, &payload);
            NewWindowResponse::Deny
        })
        .accept_first_mouse(true)
        .focused(true)
        .devtools(cfg!(any(debug_assertions, feature = "devtools")));

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map(|_| ())
        .map_err(|err| format!("failed to create browser webview {label}: {err}"))
}

#[tauri::command]
pub async fn browser_open_host(
    app: tauri::AppHandle,
    mode: Option<String>,
    url: Option<String>,
    title: Option<String>,
) -> Result<String, String> {
    dispatch_browser_command(&app, BrowserCommandPayload::open(mode, url, title)).await
}

#[tauri::command]
pub async fn browser_handle_popup(
    app: tauri::AppHandle,
    payload: BrowserPopupPayload,
) -> Result<(), String> {
    app.emit(BROWSER_POPUP_EVENT, &payload)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_set_zoom(
    app: tauri::AppHandle,
    webview_label: String,
    factor: f64,
) -> Result<(), String> {
    let label = webview_label.trim();
    if label.is_empty() {
        return Err("webview_label is required".to_string());
    }

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview not found: {}", label))?;

    webview
        .set_zoom(factor)
        .map_err(|err| format!("failed to set zoom: {}", err))
}

#[cfg(any(debug_assertions, feature = "devtools"))]
#[tauri::command]
pub fn browser_devtools_toggle(app: tauri::AppHandle, webview_label: String) -> Result<(), String> {
    let label = webview_label.trim();
    if label.is_empty() {
        return Err("webview_label is required".to_string());
    }

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview not found: {}", label))?;

    webview.open_devtools();
    Ok(())
}

#[cfg(not(any(debug_assertions, feature = "devtools")))]
#[tauri::command]
pub fn browser_devtools_toggle(
    _app: tauri::AppHandle,
    _webview_label: String,
) -> Result<(), String> {
    Err("browser devtools are only available in debug/devtools builds".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_webview_url_accepts_external_urls_and_about_blank() {
        assert!(matches!(
            browser_webview_url("https://example.com").unwrap(),
            WebviewUrl::External(_)
        ));
        assert!(matches!(
            browser_webview_url("about:blank").unwrap(),
            WebviewUrl::External(_)
        ));
    }

    #[test]
    fn browser_page_bridge_script_includes_loading_event_contract() {
        let script = build_browser_page_bridge_script("tab-1", "webview-1");

        assert!(script.contains("browser:loading"));
        assert!(script.contains("LOADING_EVENT"));
        assert!(script.contains("emitLoading"));
    }

    #[test]
    fn native_new_window_payload_routes_to_foreground_blank_tab() {
        let url = Url::parse("https://example.com/new").unwrap();
        let payload = native_new_window_popup_payload("tab-1", "webview-1", &url);

        assert_eq!(payload.tab_id, "tab-1");
        assert_eq!(payload.webview_label, "webview-1");
        assert_eq!(payload.url, "https://example.com/new");
        assert_eq!(payload.target.as_deref(), Some("_blank"));
        assert_eq!(payload.via.as_deref(), Some("target-blank"));
        assert_eq!(payload.foreground, Some(true));
    }
}
