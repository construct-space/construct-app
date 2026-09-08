//! Browser automation bridge — handles browser.* commands from operator.
//!
//! Tab management delegates into the visible `browser-main` shell.
//! DOM automation targets the shell's child webviews directly so the operator
//! works against the same browser the user sees.

use crate::browser::{
    self, BrowserCommandPayload, BrowserTabPatchPayload, BrowserTabState, SharedBrowserState,
};
// base64 is only used by the macOS-gated `image_file_data_uri` helper below.
// Gate the import too, otherwise non-macOS builds emit `unused_imports`.
#[cfg(target_os = "macos")]
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{Listener, Manager};
use tokio::sync::oneshot;

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
        "browser.close_window" => cmd_close_window(app).await,
        _ => Err((
            "not_found".to_string(),
            format!("Unknown browser method: {}", method),
        )),
    }
}

// cmd_close_window force-closes the whole in-app browser window. Unlike
// browser.close (which closes one tab and needs the window responsive), this
// is a pure Rust window.destroy() with no eval — so it recovers a wedged
// window whose eval channel has stopped responding. After this, browser.open
// builds a fresh window cleanly.
async fn cmd_close_window(app: &tauri::AppHandle) -> Result<Value, (String, String)> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(crate::browser::BROWSER_WINDOW_LABEL) {
        window
            .destroy()
            .map_err(|e| ("internal".to_string(), format!("failed to close browser window: {e}")))?;
        return Ok(json!({ "closed": true }));
    }
    Ok(json!({ "closed": false }))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn with_browser_state<T>(
    app: &tauri::AppHandle,
    f: impl FnOnce(&mut crate::browser::BrowserState) -> Result<T, (String, String)>,
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

fn get_tab_state(
    app: &tauri::AppHandle,
    tab_id: &str,
) -> Result<BrowserTabState, (String, String)> {
    with_browser_state(app, |bs| {
        bs.tabs.get(tab_id).cloned().ok_or_else(|| {
            (
                "not_found".to_string(),
                format!("Tab not found: {}", tab_id),
            )
        })
    })
}

fn get_tab_webview(
    app: &tauri::AppHandle,
    tab_id: &str,
) -> Result<tauri::Webview, (String, String)> {
    let state = get_tab_state(app, tab_id)?;
    let label = state.webview_label.ok_or_else(|| {
        (
            "not_ready".to_string(),
            format!("Tab is not attached yet: {}", tab_id),
        )
    })?;

    app.get_webview(&label).ok_or_else(|| {
        (
            "not_found".to_string(),
            format!("Webview not found for tab: {}", tab_id),
        )
    })
}

async fn wait_for_tab_webview(
    app: &tauri::AppHandle,
    tab_id: &str,
) -> Result<tauri::Webview, (String, String)> {
    for _ in 0..80 {
        if let Ok(webview) = get_tab_webview(app, tab_id) {
            return Ok(webview);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    Err((
        "timeout".to_string(),
        format!("Timed out waiting for tab to attach: {}", tab_id),
    ))
}

async fn wait_for_tab_removed(
    app: &tauri::AppHandle,
    tab_id: &str,
) -> Result<(), (String, String)> {
    for _ in 0..60 {
        if get_tab_state(app, tab_id).is_err() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    Err((
        "timeout".to_string(),
        format!("Timed out waiting for tab to close: {}", tab_id),
    ))
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

fn resolve_screenshot_tab_id(
    params: &Value,
    state: &crate::browser::BrowserState,
) -> Result<String, (String, String)> {
    if let Some(tab_id) = optional_str(params, "tab_id")
        .map(str::trim)
        .filter(|tab_id| !tab_id.is_empty())
    {
        return Ok(tab_id.to_string());
    }

    state
        .active_tab_id
        .as_deref()
        .map(str::trim)
        .filter(|tab_id| !tab_id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            (
                "no_active_tab".to_string(),
                "tab_id is required when no browser tab is active".to_string(),
            )
        })
}

fn parse_url(raw: &str) -> Result<String, (String, String)> {
    if raw.is_empty() {
        return Ok("https://construct.space".to_string());
    }
    if raw.starts_with("http://") || raw.starts_with("https://") || raw.starts_with("about:") {
        return Ok(raw.to_string());
    }
    Ok(format!("https://{}", raw))
}

fn listen_for_json_response(
    app: &tauri::AppHandle,
    event_name: &str,
) -> (tauri::EventId, oneshot::Receiver<String>) {
    let (tx, rx) = oneshot::channel();
    let listener_id = app.once_any(event_name.to_string(), move |event| {
        let _ = tx.send(event.payload().to_string());
    });
    (listener_id, rx)
}

async fn eval_json(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    js_expr: &str,
) -> Result<Value, (String, String)> {
    let event_name = format!(
        "browser-auto-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let (listener_id, rx) = listen_for_json_response(app, &event_name);

    // Injected script logs each step to the tab's devtools console with a
    // [construct-auto] prefix (visible in the tab) AND emits the result back
    // over the Tauri event so Rust can resolve `rx`. The console logs are the
    // diagnostic of last resort: if the emit channel is broken (CSP, missing
    // IPC) the Rust side times out, but devtools still shows where it died.
    let script = format!(
        r#"{ipc};(async () => {{
            var __log = function(m){{ try {{ console.log("[construct-auto] " + m); }} catch (e) {{}} }};
            var __err = function(m){{ try {{ console.error("[construct-auto] " + m); }} catch (e) {{}} }};
            __log("eval start ipc=" + (!!(window.__CONSTRUCT_TAURI_IPC__ && window.__CONSTRUCT_TAURI_IPC__.emit)) + " internals=" + (!!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke)));
            const __emit = async (payload) => {{
                try {{
                    if (window.__CONSTRUCT_TAURI_IPC__ && typeof window.__CONSTRUCT_TAURI_IPC__.emit === "function") {{
                        await window.__CONSTRUCT_TAURI_IPC__.emit("{event_name}", payload);
                        __log("emitted via __CONSTRUCT_TAURI_IPC__");
                        return;
                    }}
                    if (!window.__TAURI_INTERNALS__ || typeof window.__TAURI_INTERNALS__.invoke !== "function") {{
                        __err("no Tauri IPC available in this tab (window.ipc/__TAURI_INTERNALS__ missing)");
                        throw new Error("Tauri IPC unavailable in browser tab");
                    }}
                    await window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {{
                        event: "{event_name}",
                        payload,
                    }});
                    __log("emitted via __TAURI_INTERNALS__");
                }} catch (e) {{
                    __err("emit failed: " + (e && e.message ? e.message : String(e)));
                    throw e;
                }}
            }};

            try {{
                const __result = await ({js_expr});
                __log("eval ok, emitting result");
                await __emit(__result);
            }} catch (e) {{
                __err("eval error: " + (e && e.message ? e.message : String(e)));
                try {{ await __emit({{ error: e && e.message ? e.message : String(e) }}); }} catch (e2) {{}}
            }}
        }})()"#,
        ipc = crate::browser::build_construct_tauri_ipc_script(app),
        event_name = js_escape(&event_name),
        js_expr = js_expr,
    );

    eprintln!(
        "[browser-auto] dispatch event={} expr={:.80}",
        event_name, js_expr
    );
    if let Err(e) = webview.eval(script) {
        app.unlisten(listener_id);
        eprintln!("[browser-auto] eval injection FAILED for {}: {}", event_name, e);
        return Err(("eval_error".to_string(), format!("Failed to eval: {}", e)));
    }
    eprintln!("[browser-auto] injected, awaiting {} (8s)", event_name);

    let payload = match tokio::time::timeout(Duration::from_secs(8), rx).await {
        Ok(Ok(payload)) => {
            eprintln!("[browser-auto] response for {} ({} bytes)", event_name, payload.len());
            payload
        }
        Ok(Err(_)) => {
            app.unlisten(listener_id);
            eprintln!("[browser-auto] channel closed before response for {}", event_name);
            return Err((
                "eval_error".to_string(),
                "Browser tab response channel closed unexpectedly".to_string(),
            ));
        }
        Err(_) => {
            app.unlisten(listener_id);
            eprintln!(
                "[browser-auto] TIMEOUT after 8s for {} — script was injected but no IPC response arrived. Open the tab's devtools console and look for [construct-auto] lines (or a CSP violation) to see whether the eval ran and which emit path failed.",
                event_name
            );
            return Err((
                "timeout".to_string(),
                "Browser tab did not respond within 8s (script injected but no IPC callback — check the tab devtools console for [construct-auto] errors or a CSP violation)".to_string(),
            ));
        }
    };

    let parsed: Value = serde_json::from_str(&payload).unwrap_or(json!({ "raw": payload }));
    if let Some(error) = parsed.get("error").and_then(|v| v.as_str()) {
        return Err(("eval_error".to_string(), error.to_string()));
    }

    Ok(parsed)
}

async fn wait_for_page_ready(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
) -> Result<(), (String, String)> {
    let start = std::time::Instant::now();

    for _ in 0..80 {
        let status = eval_json(
            app,
            webview,
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
async fn eval_auto(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    js_call: &str,
) -> Result<Value, (String, String)> {
    let inject = format!(r#"if (!window.__CONSTRUCT_AUTO__) {{ {} }}"#, AUTOMATION_JS);
    webview.eval(inject).map_err(|e| {
        (
            "eval_error".to_string(),
            format!("Failed to inject runtime: {}", e),
        )
    })?;

    eval_json(app, webview, js_call).await
}

fn update_tab_state(
    app: &tauri::AppHandle,
    tab_id: &str,
    url: String,
    title: Option<String>,
) -> Result<(), (String, String)> {
    with_browser_state(app, |bs| {
        let tab = bs.tabs.get_mut(tab_id).ok_or_else(|| {
            (
                "not_found".to_string(),
                format!("Tab not found: {}", tab_id),
            )
        })?;
        tab.url = url.clone();
        if let Some(title) = title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
        {
            tab.title = title.to_string();
        }
        Ok(())
    })?;

    let _ = browser::emit_browser_tab_patch(
        app,
        &BrowserTabPatchPayload {
            tab_id: tab_id.to_string(),
            url,
            title,
        },
    );

    Ok(())
}

async fn refresh_tab_state(
    app: &tauri::AppHandle,
    tab_id: &str,
    webview: &tauri::Webview,
) -> Result<(), (String, String)> {
    let url = webview
        .url()
        .map_err(|e| ("internal".to_string(), format!("Failed to read URL: {}", e)))?
        .to_string();

    let title = eval_json(app, webview, r#"(() => document.title || "")()"#)
        .await
        .ok()
        .and_then(|value| value.as_str().map(str::to_string));

    update_tab_state(app, tab_id, url, title)
}

async fn send_browser_command(
    app: &tauri::AppHandle,
    payload: BrowserCommandPayload,
) -> Result<(), (String, String)> {
    browser::dispatch_browser_command(app, payload)
        .await
        .map(|_| ())
        .map_err(|err| ("internal".to_string(), err))
}

// ---------------------------------------------------------------------------
// Tab management commands
// ---------------------------------------------------------------------------

async fn cmd_tabs(app: &tauri::AppHandle) -> Result<Value, (String, String)> {
    let (tab_entries, active_tab_id) = with_browser_state(app, |bs| {
        Ok((
            bs.tabs
                .iter()
                .map(|(tab_id, state)| (tab_id.clone(), state.clone()))
                .collect::<Vec<_>>(),
            bs.active_tab_id.clone(),
        ))
    })?;

    let mut tabs = Vec::new();
    for (tab_id, state) in tab_entries {
        let mut url = state.url.clone();
        if let Some(label) = state.webview_label.as_deref() {
            if let Some(webview) = app.get_webview(label) {
                if let Ok(current_url) = webview.url() {
                    url = current_url.to_string();
                }
            }
        }

        tabs.push(json!({
            "id": tab_id,
            "label": state.webview_label,
            "url": url,
            "title": state.title,
            "active": active_tab_id.as_deref() == Some(tab_id.as_str()),
        }));
    }

    Ok(json!({
        "tabs": tabs,
        "active_tab_id": active_tab_id,
    }))
}

async fn cmd_open(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let nav_url = parse_url(optional_str(params, "url").unwrap_or(""))?;
    let tab_id = format!(
        "auto_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    send_browser_command(
        app,
        BrowserCommandPayload::new_tab(Some(nav_url.clone()), None, tab_id.clone()),
    )
    .await?;

    eprintln!("[browser-auto] open: tab={} url={} — waiting for tab webview", tab_id, nav_url);
    let webview = wait_for_tab_webview(app, &tab_id).await?;
    eprintln!("[browser-auto] open: tab={} webview ready, checking page readiness", tab_id);
    // Best-effort readiness only. On a cold start the page + IPC bridge can
    // take longer than the readiness eval's window, and making this fatal left
    // the whole browser window wedged (it exists, so open/navigate refuse to
    // rebuild it, yet every eval times out). The tab webview already exists by
    // here, so return it and let the caller snapshot once the page settles.
    match wait_for_page_ready(app, &webview).await {
        Ok(_) => eprintln!("[browser-auto] open: tab={} page ready", tab_id),
        Err((_, msg)) => eprintln!("[browser-auto] open: tab={} page-ready check failed (non-fatal): {}", tab_id, msg),
    }
    let _ = refresh_tab_state(app, &tab_id, &webview).await;

    Ok(json!({
        "tab_id": tab_id,
        "url": nav_url,
    }))
}

async fn cmd_close(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let _ = get_tab_state(app, tab_id)?;

    send_browser_command(app, BrowserCommandPayload::close_tab(tab_id.to_string())).await?;
    wait_for_tab_removed(app, tab_id).await?;

    Ok(json!({ "ok": true }))
}

async fn cmd_navigate(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let nav_url = parse_url(require_str(params, "url")?)?;
    let _ = get_tab_state(app, tab_id)?;

    send_browser_command(
        app,
        BrowserCommandPayload::navigate_tab(tab_id.to_string(), Some(nav_url.clone()), None),
    )
    .await?;

    let webview = wait_for_tab_webview(app, tab_id).await?;
    wait_for_page_ready(app, &webview).await?;
    let _ = refresh_tab_state(app, tab_id, &webview).await;

    Ok(json!({ "ok": true, "url": nav_url }))
}

// ---------------------------------------------------------------------------
// DOM automation commands (injected JS runtime)
// Contract: docs/plans/phase0-contracts.md §3
// ---------------------------------------------------------------------------

async fn cmd_snapshot(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let webview = wait_for_tab_webview(app, tab_id).await?;
    wait_for_page_ready(app, &webview).await?;

    let mut result = eval_auto(app, &webview, "window.__CONSTRUCT_AUTO__.snapshot()").await?;
    if let Some(url) = result.get("url").and_then(|v| v.as_str()) {
        let title = result
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let _ = update_tab_state(app, tab_id, url.to_string(), title);
    }
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

    let webview = wait_for_tab_webview(app, tab_id).await?;
    let before_url = webview.url().ok().map(|url| url.to_string());
    let js = format!(
        "window.__CONSTRUCT_AUTO__.click({}, {})",
        js_str_or_null(node_id),
        js_str_or_null(selector),
    );
    let result = eval_auto(app, &webview, &js).await?;

    tokio::time::sleep(Duration::from_millis(250)).await;
    let after_url = webview.url().ok().map(|url| url.to_string());
    if after_url != before_url {
        let _ = wait_for_page_ready(app, &webview).await;
    }
    let _ = refresh_tab_state(app, tab_id, &webview).await;

    Ok(result)
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

    let webview = wait_for_tab_webview(app, tab_id).await?;
    let js = format!(
        "window.__CONSTRUCT_AUTO__.type({}, {}, \"{}\", {})",
        js_str_or_null(node_id),
        js_str_or_null(selector),
        js_escape(text),
        clear,
    );
    eval_auto(app, &webview, &js).await
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

    let webview = wait_for_tab_webview(app, tab_id).await?;
    let before_url = webview.url().ok().map(|url| url.to_string());
    let js = format!(
        "window.__CONSTRUCT_AUTO__.pressKey({}, {}, \"{}\", [{}])",
        js_str_or_null(node_id),
        js_str_or_null(selector),
        js_escape(key),
        modifiers,
    );
    let result = eval_auto(app, &webview, &js).await?;

    tokio::time::sleep(Duration::from_millis(250)).await;
    let after_url = webview.url().ok().map(|url| url.to_string());
    if after_url != before_url {
        let _ = wait_for_page_ready(app, &webview).await;
    }
    let _ = refresh_tab_state(app, tab_id, &webview).await;

    Ok(result)
}

async fn cmd_wait_for(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = require_str(params, "tab_id")?;
    let selector = require_str(params, "selector")?;
    let state = optional_str(params, "state").unwrap_or("visible");
    let timeout_ms = params
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(5000);

    let webview = wait_for_tab_webview(app, tab_id).await?;
    let js = format!(
        "window.__CONSTRUCT_AUTO__.waitFor(\"{}\", \"{}\", {})",
        js_escape(selector),
        js_escape(state),
        timeout_ms,
    );
    eval_auto(app, &webview, &js).await
}

async fn cmd_screenshot(app: &tauri::AppHandle, params: &Value) -> Result<Value, (String, String)> {
    let tab_id = with_browser_state(app, |bs| resolve_screenshot_tab_id(params, bs))?;
    let full_page = params
        .get("full_page")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let webview = wait_for_tab_webview(app, &tab_id).await?;

    #[cfg(target_os = "macos")]
    {
        wait_for_page_ready(app, &webview).await?;
        return cmd_screenshot_macos(&webview, &tab_id, full_page).await;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = full_page;
        let _ = webview;
        Err((
            "not_implemented".to_string(),
            "Screenshot not yet supported on this platform".to_string(),
        ))
    }
}

/// macOS screenshot via screencapture -l <CGWindowID>.
/// Captures the visible browser window that hosts the tab.
#[cfg(target_os = "macos")]
async fn cmd_screenshot_macos(
    webview: &tauri::Webview,
    tab_id: &str,
    _full_page: bool,
) -> Result<Value, (String, String)> {
    use objc2_app_kit::NSWindow;

    let _ = webview.show();
    let _ = webview.set_focus();
    tokio::time::sleep(Duration::from_millis(150)).await;

    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| {
            let _ = tx.send(platform.ns_window() as usize);
        })
        .map_err(|e| {
            (
                "internal".to_string(),
                format!("Failed to access native webview: {}", e),
            )
        })?;

    let ns_window_ptr = rx.recv().map_err(|_| {
        (
            "internal".to_string(),
            "Failed to resolve native browser window".to_string(),
        )
    })? as *mut std::ffi::c_void;

    let window_id = unsafe {
        let ns_window = &*(ns_window_ptr as *const NSWindow);
        ns_window.windowNumber()
    };

    if window_id <= 0 {
        return Err(("internal".to_string(), "Invalid window ID".to_string()));
    }
    let window_id: i32 = window_id.try_into().map_err(|_| {
        (
            "internal".to_string(),
            format!("Window ID out of range: {}", window_id),
        )
    })?;

    let dir = crate::config::construct_data_dir()
        .map(|p| p.join("screenshots"))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"));
    let file_prefix = format!("construct-tab-{}", tab_id);
    let (path, width, height) =
        match capture_window_screenshot_macos(window_id, &file_prefix, &dir).await {
            Ok(capture) => capture,
            Err(err) if should_try_webview_snapshot_after_capture_error(&err.1) => {
                capture_webview_screenshot_macos(webview, &file_prefix, &dir).await?
            }
            Err(err) => return Err(err),
        };
    let data_uri = image_file_data_uri(&path, "image/png")?;

    Ok(json!({
        "tab_id": tab_id,
        "path": path,
        "data_uri": data_uri,
        "width": width,
        "height": height,
    }))
}

// Only used by the macOS screenshot path (cmd_screenshot_macos).
// Gate the cfg so non-mac builds don't trip dead_code.
#[cfg(target_os = "macos")]
pub(crate) fn image_file_data_uri(path: &str, mime_type: &str) -> Result<String, (String, String)> {
    let bytes = std::fs::read(path).map_err(|e| {
        (
            "internal".to_string(),
            format!("Failed to read screenshot file: {}", e),
        )
    })?;
    Ok(format!(
        "data:{};base64,{}",
        mime_type,
        STANDARD.encode(bytes)
    ))
}

#[cfg(target_os = "macos")]
fn prepare_screenshot_path(
    file_prefix: &str,
    dir: &std::path::Path,
) -> Result<String, (String, String)> {
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

    // Ensure the target directory exists — first screenshot of a fresh
    // install would otherwise fail on `screencapture` writing into a
    // non-existent folder.
    std::fs::create_dir_all(dir).map_err(|e| {
        (
            "internal".to_string(),
            format!("Failed to create screenshot dir: {}", e),
        )
    })?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Ok(dir
        .join(format!("{}-{}.png", prefix, timestamp))
        .to_string_lossy()
        .into_owned())
}

#[cfg(target_os = "macos")]
pub(crate) async fn capture_window_screenshot_macos(
    window_id: i32,
    file_prefix: &str,
    dir: &std::path::Path,
) -> Result<(String, u32, u32), (String, String)> {
    if window_id <= 0 {
        return Err(("internal".to_string(), "Invalid window ID".to_string()));
    }

    let path = prepare_screenshot_path(file_prefix, dir)?;

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
        if should_fallback_to_fullscreen_capture(&stderr) {
            let fallback = tokio::process::Command::new("screencapture")
                .args(["-o", "-x", &path])
                .output()
                .await
                .map_err(|e| {
                    (
                        "internal".to_string(),
                        format!("screencapture fullscreen fallback failed: {}", e),
                    )
                })?;

            if fallback.status.success() {
                let (width, height) = get_png_dimensions(&path).unwrap_or((0, 0));
                return Ok((path, width, height));
            }

            let fallback_stderr = String::from_utf8_lossy(&fallback.stderr);
            return Err((
                "internal".to_string(),
                format!(
                    "screencapture window error: {}; fullscreen fallback error: {}",
                    stderr.trim(),
                    fallback_stderr.trim()
                ),
            ));
        }
        return Err((
            "internal".to_string(),
            format!("screencapture error: {}", stderr),
        ));
    }

    let (width, height) = get_png_dimensions(&path).unwrap_or((0, 0));
    Ok((path, width, height))
}

#[cfg(target_os = "macos")]
async fn capture_webview_screenshot_macos(
    webview: &tauri::Webview,
    file_prefix: &str,
    dir: &std::path::Path,
) -> Result<(String, u32, u32), (String, String)> {
    let path = prepare_screenshot_path(file_prefix, dir)?;
    let path_for_callback = path.clone();
    let (tx, rx) = std::sync::mpsc::channel();

    webview
        .with_webview(move |platform| {
            if let Err(err) =
                unsafe { start_wk_webview_snapshot_to_png(platform.inner(), path_for_callback, tx) }
            {
                // If starting the async snapshot fails, the completion
                // sender is gone; the waiter below will return a timeout.
                eprintln!("[construct] failed to start WebKit screenshot: {:?}", err);
            }
        })
        .map_err(|e| {
            (
                "internal".to_string(),
                format!("Failed to access native webview: {}", e),
            )
        })?;

    wait_for_webview_snapshot_result(rx)
        .await
        .map(|(width, height)| {
            let (width, height) = if width == 0 || height == 0 {
                get_png_dimensions(&path).unwrap_or((width, height))
            } else {
                (width, height)
            };
            (path, width, height)
        })
}

#[cfg(target_os = "macos")]
pub(crate) async fn capture_webview_window_screenshot_macos(
    window: &tauri::WebviewWindow,
    file_prefix: &str,
    dir: &std::path::Path,
) -> Result<(String, u32, u32), (String, String)> {
    let path = prepare_screenshot_path(file_prefix, dir)?;
    let path_for_callback = path.clone();
    let (tx, rx) = std::sync::mpsc::channel();

    window
        .with_webview(move |platform| {
            if let Err(err) =
                unsafe { start_wk_webview_snapshot_to_png(platform.inner(), path_for_callback, tx) }
            {
                eprintln!("[construct] failed to start WebKit screenshot: {:?}", err);
            }
        })
        .map_err(|e| {
            (
                "internal".to_string(),
                format!("Failed to access native webview: {}", e),
            )
        })?;

    wait_for_webview_snapshot_result(rx)
        .await
        .map(|(width, height)| {
            let (width, height) = if width == 0 || height == 0 {
                get_png_dimensions(&path).unwrap_or((width, height))
            } else {
                (width, height)
            };
            (path, width, height)
        })
}

#[cfg(target_os = "macos")]
async fn wait_for_webview_snapshot_result(
    rx: std::sync::mpsc::Receiver<Result<(u32, u32), (String, String)>>,
) -> Result<(u32, u32), (String, String)> {
    tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(5)))
        .await
        .map_err(|e| {
            (
                "internal".to_string(),
                format!("WebKit snapshot waiter failed: {}", e),
            )
        })?
        .map_err(|_| {
            (
                "internal".to_string(),
                "WebKit snapshot timed out".to_string(),
            )
        })?
}

#[cfg(target_os = "macos")]
unsafe fn start_wk_webview_snapshot_to_png(
    webview_ptr: *mut std::ffi::c_void,
    path: String,
    tx: std::sync::mpsc::Sender<Result<(u32, u32), (String, String)>>,
) -> Result<(), (String, String)> {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;

    if webview_ptr.is_null() {
        return Err((
            "internal".to_string(),
            "Invalid webview pointer".to_string(),
        ));
    }

    let webview = &*(webview_ptr as *const WKWebView);
    let bounds = webview.bounds();
    let fallback_width = bounds.size.width.max(0.0).round() as u32;
    let fallback_height = bounds.size.height.max(0.0).round() as u32;
    let block = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let result = (|| -> Result<(u32, u32), (String, String)> {
            if !error.is_null() {
                let error = unsafe { &*error };
                Err((
                    "internal".to_string(),
                    format!("WebKit snapshot failed: {}", error.localizedDescription()),
                ))
            } else if image.is_null() {
                Err((
                    "internal".to_string(),
                    "WebKit snapshot returned no image".to_string(),
                ))
            } else {
                let image = unsafe { &*image };
                let tiff = image.TIFFRepresentation().ok_or_else(|| {
                    (
                        "internal".to_string(),
                        "WebKit snapshot image had no TIFF representation".to_string(),
                    )
                })?;
                let bitmap = NSBitmapImageRep::imageRepWithData(&tiff).ok_or_else(|| {
                    (
                        "internal".to_string(),
                        "Failed to decode WebKit snapshot image".to_string(),
                    )
                })?;
                let properties =
                    NSDictionary::<objc2_app_kit::NSBitmapImageRepPropertyKey, AnyObject>::new();
                let png = unsafe {
                    bitmap
                        .representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
                }
                .ok_or_else(|| {
                    (
                        "internal".to_string(),
                        "Failed to encode WebKit snapshot as PNG".to_string(),
                    )
                })?;
                std::fs::write(&path, unsafe { png.as_bytes_unchecked() }).map_err(|e| {
                    (
                        "internal".to_string(),
                        format!("Failed to write WebKit screenshot: {}", e),
                    )
                })?;

                let reps = image.representations();
                let mut width = fallback_width;
                let mut height = fallback_height;
                if reps.count() > 0 {
                    let rep = reps.objectAtIndex(0);
                    let size = rep.size();
                    width = size.width.max(0.0).round() as u32;
                    height = size.height.max(0.0).round() as u32;
                }
                Ok((width, height))
            }
        })();
        let _ = tx.send(result);
    });

    webview.takeSnapshotWithConfiguration_completionHandler(None, &block);
    // WebKit completes asynchronously after this function returns. Keep the
    // block alive for the process lifetime rather than risking it being
    // dropped before WebKit calls back.
    std::mem::forget(block);
    Ok(())
}

#[cfg(target_os = "macos")]
fn should_fallback_to_fullscreen_capture(stderr: &str) -> bool {
    stderr
        .to_ascii_lowercase()
        .contains("could not create image from window")
}

#[cfg(target_os = "macos")]
pub(crate) fn should_try_webview_snapshot_after_capture_error(message: &str) -> bool {
    message.to_ascii_lowercase().contains("screencapture")
}

/// Read PNG width/height from the IHDR chunk header.
#[cfg(target_os = "macos")]
fn get_png_dimensions(path: &str) -> Option<(u32, u32)> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let mut header = [0u8; 24];
    f.read_exact(&mut header).ok()?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::{BrowserState, BrowserTabState};
    use base64::{engine::general_purpose::STANDARD, Engine};

    #[test]
    fn screenshot_tab_id_uses_explicit_tab_when_present() {
        let mut state = BrowserState::default();
        state.active_tab_id = Some("active-tab".to_string());

        let tab_id = resolve_screenshot_tab_id(&json!({ "tab_id": "explicit-tab" }), &state)
            .expect("explicit tab id should resolve");

        assert_eq!(tab_id, "explicit-tab");
    }

    #[test]
    fn screenshot_tab_id_defaults_to_active_tab() {
        let mut state = BrowserState::default();
        state.tabs.insert(
            "active-tab".to_string(),
            BrowserTabState {
                webview_label: Some("webview-1".to_string()),
                url: "https://construct.space".to_string(),
                title: "Construct".to_string(),
            },
        );
        state.active_tab_id = Some("active-tab".to_string());

        let tab_id = resolve_screenshot_tab_id(&json!({}), &state)
            .expect("missing tab id should resolve to active tab");

        assert_eq!(tab_id, "active-tab");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn image_file_data_uri_encodes_png_bytes() {
        let path = std::env::temp_dir().join(format!(
            "construct-data-uri-test-{}.png",
            std::process::id()
        ));
        let bytes = b"fake-png-bytes";
        std::fs::write(&path, bytes).expect("write test image bytes");

        let uri = image_file_data_uri(&path.to_string_lossy(), "image/png")
            .expect("image data uri should encode");

        assert_eq!(
            uri,
            format!("data:image/png;base64,{}", STANDARD.encode(bytes))
        );

        let _ = std::fs::remove_file(path);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_window_capture_error_uses_screen_fallback() {
        assert!(should_fallback_to_fullscreen_capture(
            "screencapture: could not create image from window"
        ));
        assert!(!should_fallback_to_fullscreen_capture(
            "screencapture: user canceled"
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_screencapture_errors_use_webkit_snapshot_fallback() {
        assert!(should_try_webview_snapshot_after_capture_error(
            "screencapture window error: could not create image from window; fullscreen fallback error: could not create image from display"
        ));
        assert!(!should_try_webview_snapshot_after_capture_error(
            "Failed to access native webview"
        ));
    }
}
