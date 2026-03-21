//! Browser automation bridge — handles browser.* commands from operator.
//!
//! Tab management (open/close/navigate/tabs) delegates to existing Tauri window APIs.
//! DOM automation (snapshot/click/type/press_key/wait_for) injects a JS runtime
//! into the target webview and calls typed functions on it.
//! Screenshot uses platform-native capture.

use crate::SharedBrowserState;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// The automation JS runtime, compiled into the binary.
const AUTOMATION_JS: &str = include_str!("automation.js");

/// Dispatch a browser.* bridge method.
pub async fn dispatch(
    app: &tauri::AppHandle,
    method: &str,
    params: &Value,
) -> Result<Value, (String, String)> {
    match method {
        "browser.tabs" => cmd_tabs(app).await,
        "browser.open" => cmd_open(app, params).await,
        "browser.close" => cmd_close(app, params).await,
        "browser.navigate" => cmd_navigate(app, params).await,
        "browser.snapshot" => cmd_snapshot(app, params).await,
        "browser.click" => cmd_click(app, params).await,
        "browser.type" => cmd_type(app, params).await,
        "browser.press_key" => cmd_press_key(app, params).await,
        "browser.wait_for" => cmd_wait_for(app, params).await,
        "browser.screenshot" => cmd_screenshot(app, params).await,
        _ => Err((
            "not_found".to_string(),
            format!("Unknown browser method: {}", method),
        )),
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn with_browser_state<T>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&mut crate::BrowserState) -> Result<T, (String, String)>,
) -> Result<T, (String, String)> {
    let state = app.state::<SharedBrowserState>();
    let mut guard = state.lock().map_err(|_| {
        (
            "internal".to_string(),
            "Browser state lock poisoned".to_string(),
        )
    })?;
    f(&mut guard)
}

fn get_tab_window(
    app: &tauri::AppHandle,
    tab_id: &str,
) -> Result<tauri::WebviewWindow, (String, String)> {
    let label = with_browser_state(app, |bs| {
        bs.tabs.get(tab_id).cloned().ok_or_else(|| {
            (
                "not_found".to_string(),
                format!("Tab not found: {}", tab_id),
            )
        })
    })?;
    app.get_webview_window(&label).ok_or_else(|| {
        (
            "not_found".to_string(),
            format!("Window not found for tab: {}", tab_id),
        )
    })
}

fn require_str<'a>(params: &'a Value, key: &str) -> Result<&'a str, (String, String)> {
    params.get(key).and_then(|v| v.as_str()).ok_or_else(|| {
        (
            "invalid_params".to_string(),
            format!("Missing required string param: {}", key),
        )
    })
}

fn optional_str<'a>(params: &'a Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(|v| v.as_str())
}

fn parse_url(raw: &str) -> Result<String, (String, String)> {
    if raw.is_empty() {
        return Ok("https://www.google.com".to_string());
    }
    if raw.starts_with("http://") || raw.starts_with("https://") || raw.starts_with("about:") {
        return Ok(raw.to_string());
    }
    Ok(format!("https://{}", raw))
}

async fn eval_json(
    window: &tauri::WebviewWindow,
    js_expr: &str,
) -> Result<Value, (String, String)> {
    let cb_id = format!(
        "__construct_eval_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );

    let script = format!(
        r#"(async () => {{
            try {{
                const __result = await ({js_expr});
                document.documentElement.setAttribute('{cb_id}', JSON.stringify(__result));
            }} catch(e) {{
                document.documentElement.setAttribute('{cb_id}', JSON.stringify({{error: e.message}}));
            }}
        }})()"#,
        js_expr = js_expr,
        cb_id = cb_id,
    );
    window
        .eval(&script)
        .map_err(|e| ("eval_error".to_string(), format!("Failed to eval: {}", e)))?;

    let read_script = format!(
        r#"(function() {{
            const v = document.documentElement.getAttribute('{cb_id}');
            if (v) {{
                document.documentElement.removeAttribute('{cb_id}');
                document.title = '__CONSTRUCT_RESULT__:' + v;
            }}
        }})()"#,
        cb_id = cb_id,
    );

    for i in 0..60 {
        let delay = if i == 0 { 50 } else { 100 };
        tokio::time::sleep(Duration::from_millis(delay)).await;
        window
            .eval(&read_script)
            .map_err(|e| ("eval_error".to_string(), format!("Poll eval failed: {}", e)))?;
        tokio::time::sleep(Duration::from_millis(30)).await;

        if let Ok(title) = window.title() {
            if let Some(payload) = title.strip_prefix("__CONSTRUCT_RESULT__:") {
                let parsed: Value =
                    serde_json::from_str(payload).unwrap_or(json!({"raw": payload}));
                window
                    .eval("document.title = document.querySelector('title')?.textContent || ''")
                    .ok();
                if let Some(error) = parsed.get("error").and_then(|v| v.as_str()) {
                    return Err(("eval_error".to_string(), error.to_string()));
                }
                return Ok(parsed);
            }
        }
    }

    Err((
        "timeout".to_string(),
        "Automation JS did not respond within 8s".to_string(),
    ))
}

async fn wait_for_page_ready(window: &tauri::WebviewWindow) -> Result<(), (String, String)> {
    let start = std::time::Instant::now();

    for _ in 0..80 {
        let status = eval_json(
            window,
            r#"(() => ({
                readyState: document.readyState,
                hasBody: !!document.body,
                childCount: document.body ? document.body.children.length : 0,
                textLength: document.body ? (document.body.innerText || '').trim().length : 0,
                url: location.href || ''
            }))()"#,
        )
        .await?;

        let ready_state = status
            .get("readyState")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let has_body = status
            .get("hasBody")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let child_count = status
            .get("childCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let text_length = status
            .get("textLength")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let url = status.get("url").and_then(|v| v.as_str()).unwrap_or("");

        let dom_ready = ready_state == "interactive" || ready_state == "complete";
        let painted = child_count > 0 || text_length > 0;
        let non_blank_url = !url.is_empty() && url != "about:blank";

        if dom_ready
            && has_body
            && non_blank_url
            && (painted || start.elapsed() > Duration::from_millis(1500))
        {
            tokio::time::sleep(Duration::from_millis(200)).await;
            return Ok(());
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    Err((
        "timeout".to_string(),
        "Page did not finish rendering in time".to_string(),
    ))
}

/// Ensure the automation runtime is injected, then execute a JS expression.
/// Returns the result parsed as JSON via a DOM title hack (eval doesn't return values).
async fn eval_auto(
    window: &tauri::WebviewWindow,
    js_call: &str,
) -> Result<Value, (String, String)> {
    // Inject runtime if not already present
    let inject = format!(r#"if (!window.__CONSTRUCT_AUTO__) {{ {} }}"#, AUTOMATION_JS);
    window.eval(&inject).map_err(|e| {
        (
            "eval_error".to_string(),
            format!("Failed to inject runtime: {}", e),
        )
    })?;

    // Use a unique callback ID to retrieve the result via document.title
    let cb_id = format!(
        "__ca_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );

    // Execute the call and write result to a data attribute on <html>
    let script = format!(
        r#"(async () => {{
            try {{
                const __result = await ({js_call});
                document.documentElement.setAttribute('{cb_id}', JSON.stringify(__result));
            }} catch(e) {{
                document.documentElement.setAttribute('{cb_id}', JSON.stringify({{error: e.message}}));
            }}
        }})()"#,
        js_call = js_call,
        cb_id = cb_id,
    );
    window
        .eval(&script)
        .map_err(|e| ("eval_error".to_string(), format!("Failed to eval: {}", e)))?;

    // Poll for the result attribute (eval is fire-and-forget in Tauri).
    // Use document.title as a return channel since eval() doesn't return values.
    let read_script = format!(
        r#"(function() {{
            const v = document.documentElement.getAttribute('{cb_id}');
            if (v) {{
                document.documentElement.removeAttribute('{cb_id}');
                document.title = '__CONSTRUCT_RESULT__:' + v;
            }}
        }})()"#,
        cb_id = cb_id,
    );

    // Poll with small delays — the async JS needs time to complete
    for i in 0..60 {
        // Wait a bit before first poll, more between retries
        let delay = if i == 0 { 50 } else { 100 };
        tokio::time::sleep(Duration::from_millis(delay)).await;

        // Trigger the read
        window
            .eval(&read_script)
            .map_err(|e| ("eval_error".to_string(), format!("Poll eval failed: {}", e)))?;

        // Small delay for the title to update
        tokio::time::sleep(Duration::from_millis(30)).await;

        // Check the title
        if let Ok(title) = window.title() {
            if let Some(payload) = title.strip_prefix("__CONSTRUCT_RESULT__:") {
                let parsed: Value =
                    serde_json::from_str(payload).unwrap_or(json!({"raw": payload}));
                // Restore original title
                window
                    .eval("document.title = document.querySelector('title')?.textContent || ''")
                    .ok();
                return Ok(parsed);
            }
        }
    }

    Err((
        "timeout".to_string(),
        "Automation JS did not respond within 8s".to_string(),
    ))
}

// ---------------------------------------------------------------------------
// Tab management commands
// ---------------------------------------------------------------------------

async fn cmd_tabs(app: &tauri::AppHandle) -> Result<Value, (String, String)> {
    // Collect tab info while holding the lock, then drop it before accessing windows
    let tab_entries: Vec<(String, String)> = with_browser_state(app, |bs| {
        Ok(bs
            .tabs
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect())
    })?;

    let mut tabs = Vec::new();
    for (tab_id, label) in &tab_entries {
        let mut info = json!({ "id": tab_id, "label": label });
        if let Some(win) = app.get_webview_window(label) {
            if let Ok(url) = win.url() {
                info["url"] = json!(url.to_string());
            }
            if let Ok(title) = win.title() {
                info["title"] = json!(title);
            }
        }
        tabs.push(info);
    }
    Ok(json!({ "tabs": tabs }))
}

async fn cmd_open(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let url_raw = optional_str(params, "url").unwrap_or("");
    let nav_url = parse_url(url_raw)?;

    // Generate tab ID
    let tab_id = format!(
        "auto_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let window_label = format!("browser-{}", tab_id);

    let parsed_url: tauri::Url = nav_url
        .parse()
        .map_err(|e| ("invalid_params".to_string(), format!("Invalid URL: {}", e)))?;
    let webview_url = WebviewUrl::External(parsed_url);

    // Get main window for parenting
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| ("internal".to_string(), "Main window not found".to_string()))?;

    let window = WebviewWindowBuilder::new(app, &window_label, webview_url)
        .title("Browser Tab")
        .decorations(false)
        .transparent(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(true)
        .inner_size(1024.0, 768.0)
        .parent(&main_window)
        .map_err(|e| {
            (
                "internal".to_string(),
                format!("Failed to set parent: {}", e),
            )
        })?
        .build()
        .map_err(|e| {
            (
                "internal".to_string(),
                format!("Failed to create window: {}", e),
            )
        })?;

    // Store in state
    with_browser_state(app, |bs| {
        bs.tabs.insert(tab_id.clone(), window_label);
        Ok(())
    })?;

    if let Err(err) = wait_for_page_ready(&window).await {
        with_browser_state(app, |bs| {
            bs.tabs.remove(&tab_id);
            Ok(())
        })?;
        let _ = window.close();
        return Err(err);
    }

    Ok(json!({
        "tab_id": tab_id,
        "url": nav_url,
    }))
}

async fn cmd_close(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let window = get_tab_window(app, tab_id)?;

    // Remove from state
    with_browser_state(app, |bs| {
        bs.tabs.remove(tab_id);
        Ok(())
    })?;

    window
        .close()
        .map_err(|e| ("internal".to_string(), format!("Failed to close: {}", e)))?;

    Ok(json!({ "ok": true }))
}

async fn cmd_navigate(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let url_raw = require_str(params, "url")?;
    let nav_url = parse_url(url_raw)?;

    let window = get_tab_window(app, tab_id)?;
    let parsed: tauri::Url = nav_url
        .parse()
        .map_err(|e| ("invalid_params".to_string(), format!("Invalid URL: {}", e)))?;

    window
        .navigate(parsed)
        .map_err(|e| ("internal".to_string(), format!("Navigation failed: {}", e)))?;

    Ok(json!({ "ok": true, "url": nav_url }))
}

// ---------------------------------------------------------------------------
// DOM automation commands (injected JS runtime)
// Contract: docs/plans/phase0-contracts.md §3
// ---------------------------------------------------------------------------

async fn cmd_snapshot(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let window = get_tab_window(app, tab_id)?;
    wait_for_page_ready(&window).await?;
    // Returns { url, title, nodes: [{ id, tag, role?, name?, text?, value?, attributes?, children? }] }
    let mut result = eval_auto(&window, "window.__CONSTRUCT_AUTO__.snapshot()").await?;
    result["tab_id"] = json!(tab_id);
    Ok(result)
}

async fn cmd_click(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let node_id = optional_str(params, "node_id");
    let selector = optional_str(params, "selector");

    if node_id.is_none() && selector.is_none() {
        return Err((
            "invalid_params".to_string(),
            "Provide 'node_id' or 'selector'".to_string(),
        ));
    }

    let window = get_tab_window(app, tab_id)?;
    let js = format!(
        "window.__CONSTRUCT_AUTO__.click({}, {})",
        js_str_or_null(node_id),
        js_str_or_null(selector),
    );
    eval_auto(&window, &js).await
}

async fn cmd_type(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let text = require_str(params, "text")?;
    let node_id = optional_str(params, "node_id");
    let selector = optional_str(params, "selector");
    let clear = params
        .get("clear")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let window = get_tab_window(app, tab_id)?;
    let js = format!(
        "window.__CONSTRUCT_AUTO__.type({}, {}, \"{}\", {})",
        js_str_or_null(node_id),
        js_str_or_null(selector),
        js_escape(text),
        clear,
    );
    eval_auto(&window, &js).await
}

async fn cmd_press_key(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let key = require_str(params, "key")?;
    let node_id = optional_str(params, "node_id");
    let selector = optional_str(params, "selector");
    let modifiers = params
        .get("modifiers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| format!("\"{}\"", js_escape(s)))
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();

    let window = get_tab_window(app, tab_id)?;
    let js = format!(
        "window.__CONSTRUCT_AUTO__.pressKey({}, {}, \"{}\", [{}])",
        js_str_or_null(node_id),
        js_str_or_null(selector),
        js_escape(key),
        modifiers,
    );
    eval_auto(&window, &js).await
}

async fn cmd_wait_for(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let selector = require_str(params, "selector")?;
    let state = optional_str(params, "state").unwrap_or("visible");
    let timeout_ms = params
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(5000);

    let window = get_tab_window(app, tab_id)?;
    let js = format!(
        "window.__CONSTRUCT_AUTO__.waitFor(\"{}\", \"{}\", {})",
        js_escape(selector),
        js_escape(state),
        timeout_ms,
    );
    eval_auto(&window, &js).await
}

async fn cmd_screenshot(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let full_page = params
        .get("full_page")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let window = get_tab_window(app, tab_id)?;

    #[cfg(target_os = "macos")]
    {
        return cmd_screenshot_macos(&window, tab_id, full_page).await;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err((
            "not_implemented".to_string(),
            "Screenshot not yet supported on this platform".to_string(),
        ))
    }
}

/// macOS screenshot via screencapture -l <CGWindowID>.
/// When full_page is true, temporarily resize the webview to the full scroll height,
/// capture, then restore original size.
#[cfg(target_os = "macos")]
async fn cmd_screenshot_macos(
    window: &tauri::WebviewWindow,
    tab_id: &str,
    full_page: bool,
) -> Result<Value, (String, String)> {
    use objc2_app_kit::NSWindow;

    wait_for_page_ready(window).await?;
    let _ = window.show();
    let _ = window.set_focus();
    tokio::time::sleep(Duration::from_millis(150)).await;

    // If full_page, resize the window to the full document height before capture
    let original_size = if full_page {
        let size = window.inner_size().map_err(|e| {
            (
                "internal".to_string(),
                format!("Failed to get window size: {}", e),
            )
        })?;
        // Get the scroll height via JS and resize
        window.eval(&format!(
            "document.title = '__CONSTRUCT_DIM__:' + JSON.stringify({{ scrollHeight: document.documentElement.scrollHeight, scrollWidth: document.documentElement.scrollWidth }})"
        )).ok();
        tokio::time::sleep(Duration::from_millis(50)).await;

        let mut scroll_height = None;
        if let Ok(title) = window.title() {
            if let Some(payload) = title.strip_prefix("__CONSTRUCT_DIM__:") {
                if let Ok(dims) = serde_json::from_str::<Value>(payload) {
                    scroll_height = dims.get("scrollHeight").and_then(|v| v.as_f64());
                }
            }
        }
        // Restore title
        window
            .eval("document.title = document.querySelector('title')?.textContent || ''")
            .ok();

        if let Some(sh) = scroll_height {
            let new_height = (sh as u32).min(16000); // Cap at 16000px to avoid absurd sizes
            window
                .set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: size.width as f64,
                    height: new_height as f64,
                }))
                .ok();
            // Wait for resize and reflow
            tokio::time::sleep(Duration::from_millis(200)).await;
            Some(size)
        } else {
            None
        }
    } else {
        None
    };

    // Get the CGWindowID from the NSWindow
    let ns_window_ptr = window.ns_window().map_err(|e| {
        (
            "internal".to_string(),
            format!("Failed to get NSWindow: {}", e),
        )
    })?;
    let window_id = unsafe {
        let ns_window = &*(ns_window_ptr as *const NSWindow);
        ns_window.windowNumber()
    };

    if window_id <= 0 {
        // Restore size if we changed it
        if let Some(orig) = original_size {
            window.set_size(tauri::Size::Physical(orig)).ok();
        }
        return Err(("internal".to_string(), "Invalid window ID".to_string()));
    }
    let window_id: i32 = window_id.try_into().map_err(|_| {
        (
            "internal".to_string(),
            format!("Window ID out of range: {}", window_id),
        )
    })?;

    // Restore original size if we changed it
    if let Some(orig) = original_size {
        window.set_size(tauri::Size::Physical(orig)).ok();
    }

    let (path, width, height) =
        capture_window_screenshot_macos(window_id, &format!("construct-tab-{}", tab_id)).await?;

    Ok(json!({
        "tab_id": tab_id,
        "path": path,
        "width": width,
        "height": height,
    }))
}

#[cfg(target_os = "macos")]
pub(crate) async fn capture_window_screenshot_macos(
    window_id: i32,
    file_prefix: &str,
) -> Result<(String, u32, u32), (String, String)> {
    if window_id <= 0 {
        return Err(("internal".to_string(), "Invalid window ID".to_string()));
    }

    let prefix: String = file_prefix
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let prefix = if prefix.trim_matches('-').is_empty() {
        "construct-screenshot".to_string()
    } else {
        prefix
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let path = format!("/tmp/{}-{}.png", prefix, timestamp);

    let output = tokio::process::Command::new("screencapture")
        .args(["-l", &window_id.to_string(), "-o", "-x", &path])
        .output()
        .await
        .map_err(|e| {
            (
                "internal".to_string(),
                format!("screencapture failed: {}", e),
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err((
            "internal".to_string(),
            format!("screencapture error: {}", stderr),
        ));
    }

    let (width, height) = get_png_dimensions(&path).unwrap_or((0, 0));
    Ok((path, width, height))
}

/// Read PNG width/height from the IHDR chunk header.
#[cfg(target_os = "macos")]
fn get_png_dimensions(path: &str) -> Option<(u32, u32)> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let mut header = [0u8; 24];
    f.read_exact(&mut header).ok()?;
    // PNG signature (8 bytes) + IHDR length (4 bytes) + "IHDR" (4 bytes) + width (4 bytes BE) + height (4 bytes BE)
    let width = u32::from_be_bytes([header[16], header[17], header[18], header[19]]);
    let height = u32::from_be_bytes([header[20], header[21], header[22], header[23]]);
    Some((width, height))
}

// ---------------------------------------------------------------------------
// JS string helpers
// ---------------------------------------------------------------------------

fn js_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn js_str_or_null(s: Option<&str>) -> String {
    match s {
        Some(v) => format!("\"{}\"", js_escape(v)),
        None => "null".to_string(),
    }
}
