//! Browser tab management: create, navigate, close, bounds, standalone windows.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize)]
pub(crate) struct BrowserTabInfo {
    id: String,
    url: String,
    title: String,
    can_go_back: bool,
    can_go_forward: bool,
}

pub struct BrowserState {
    pub tabs: HashMap<String, String>,
}

pub type SharedBrowserState = Arc<Mutex<BrowserState>>;

pub fn new_state() -> SharedBrowserState {
    Arc::new(Mutex::new(BrowserState {
        tabs: HashMap::new(),
    }))
}

#[tauri::command]
pub async fn browser_create_tab(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
    url: String,
) -> Result<BrowserTabInfo, String> {
    let window_label = format!("browser-{}", tab_id);

    eprintln!("[Browser] Creating tab {} with URL: {}", tab_id, url);

    let nav_url = if url.is_empty() {
        "https://www.google.com".to_string()
    } else if !url.starts_with("http://")
        && !url.starts_with("https://")
        && !url.starts_with("about:")
    {
        format!("https://{}", url)
    } else {
        url.clone()
    };

    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let webview_url =
        WebviewUrl::External(nav_url.parse().map_err(|e| format!("Invalid URL: {}", e))?);

    let _window = WebviewWindowBuilder::new(&app, &window_label, webview_url)
        .title("Browser Tab")
        .decorations(false)
        .transparent(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .inner_size(800.0, 600.0)
        .parent(&main_window)
        .map_err(|e| format!("Failed to set parent: {}", e))?
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    {
        let mut browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.insert(tab_id.clone(), window_label);
    }

    Ok(BrowserTabInfo {
        id: tab_id,
        url: nav_url,
        title: "New Tab".to_string(),
        can_go_back: false,
        can_go_forward: false,
    })
}

#[tauri::command]
pub async fn browser_close_tab(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let window_label = {
        let mut browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.remove(&tab_id)
    };

    if let Some(label) = window_label {
        if let Some(window) = app.get_webview_window(&label) {
            window
                .close()
                .map_err(|e| format!("Failed to close window: {}", e))?;
        }
    }

    eprintln!("[Browser] Closed tab {}", tab_id);
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let window_label = {
        let browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.get(&tab_id).cloned()
    };

    let label = window_label.ok_or_else(|| format!("Tab {} not found", tab_id))?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window {} not found", label))?;

    let nav_url = if !url.starts_with("http://")
        && !url.starts_with("https://")
        && !url.starts_with("about:")
    {
        format!("https://{}", url)
    } else {
        url
    };

    let parsed_url: tauri::Url = nav_url.parse().map_err(|e| format!("Invalid URL: {}", e))?;
    window
        .navigate(parsed_url)
        .map_err(|e| format!("Navigation failed: {}", e))?;

    eprintln!("[Browser] Tab {} navigating to: {}", tab_id, nav_url);
    Ok(())
}

#[tauri::command]
pub async fn browser_set_tab_visible(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
    visible: bool,
) -> Result<(), String> {
    let window_label = {
        let browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.get(&tab_id).cloned()
    };

    let label = window_label.ok_or_else(|| format!("Tab {} not found", tab_id))?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window {} not found", label))?;

    if visible {
        window.show().map_err(|e| format!("Show failed: {}", e))?;
        window
            .set_focus()
            .map_err(|e| format!("Focus failed: {}", e))?;
    } else {
        window.hide().map_err(|e| format!("Hide failed: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn browser_reload(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let window_label = {
        let browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.get(&tab_id).cloned()
    };

    let label = window_label.ok_or_else(|| format!("Tab {} not found", tab_id))?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window {} not found", label))?;

    window
        .eval("location.reload()")
        .map_err(|e| format!("Reload failed: {}", e))?;

    eprintln!("[Browser] Reloading tab {}", tab_id);
    Ok(())
}

#[tauri::command]
pub async fn browser_get_url(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
) -> Result<String, String> {
    let window_label = {
        let browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.get(&tab_id).cloned()
    };

    let label = window_label.ok_or_else(|| format!("Tab {} not found", tab_id))?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window {} not found", label))?;

    window
        .url()
        .map(|u| u.to_string())
        .map_err(|e| format!("Failed to get URL: {}", e))
}

#[tauri::command]
pub async fn browser_toggle_devtools(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
) -> Result<(), String> {
    eprintln!(
        "[Browser] Devtools toggle requested for tab {} (not available in this build)",
        tab_id
    );
    Ok(())
}

#[tauri::command]
pub async fn browser_close_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
) -> Result<(), String> {
    let tabs: Vec<String> = {
        let mut browser_state = state.lock().map_err(|_| "Lock error")?;
        let labels: Vec<String> = browser_state.tabs.values().cloned().collect();
        browser_state.tabs.clear();
        labels
    };

    for label in tabs {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }

    eprintln!("[Browser] Closed all tabs");
    Ok(())
}

#[tauri::command]
pub async fn browser_open_standalone(
    app: tauri::AppHandle,
    url: String,
    title: String,
    width: f64,
    height: f64,
) -> Result<String, String> {
    let window_id = format!(
        "standalone-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );

    eprintln!(
        "[Browser] Opening standalone window: {} ({}x{})",
        url, width, height
    );

    let nav_url = if url.is_empty() {
        "https://www.google.com".to_string()
    } else if !url.starts_with("http://") && !url.starts_with("https://") {
        format!("https://{}", url)
    } else {
        url.clone()
    };

    let webview_url =
        WebviewUrl::External(nav_url.parse().map_err(|e| format!("Invalid URL: {}", e))?);

    let _window = WebviewWindowBuilder::new(&app, &window_id, webview_url)
        .title(&title)
        .decorations(true)
        .transparent(false)
        .resizable(true)
        .skip_taskbar(false)
        .visible(true)
        .inner_size(width, height)
        .center()
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    eprintln!("[Browser] Standalone window created: {}", window_id);
    Ok(window_id)
}

#[tauri::command]
pub async fn browser_go_back(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let window_label = {
        let browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.get(&tab_id).cloned()
    };

    let label = window_label.ok_or_else(|| format!("Tab {} not found", tab_id))?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window {} not found", label))?;

    window
        .eval("history.back()")
        .map_err(|e| format!("Back failed: {}", e))?;

    eprintln!("[Browser] Tab {} going back", tab_id);
    Ok(())
}

#[tauri::command]
pub async fn browser_go_forward(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
) -> Result<(), String> {
    let window_label = {
        let browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.get(&tab_id).cloned()
    };

    let label = window_label.ok_or_else(|| format!("Tab {} not found", tab_id))?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window {} not found", label))?;

    window
        .eval("history.forward()")
        .map_err(|e| format!("Forward failed: {}", e))?;

    eprintln!("[Browser] Tab {} going forward", tab_id);
    Ok(())
}

#[tauri::command]
pub async fn browser_set_tab_bounds(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedBrowserState>,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window_label = {
        let browser_state = state.lock().map_err(|_| "Lock error")?;
        browser_state.tabs.get(&tab_id).cloned()
    };

    let label = window_label.ok_or_else(|| format!("Tab {} not found", tab_id))?;
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Window {} not found", label))?;

    use tauri::{LogicalPosition, LogicalSize};
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("Failed to set position: {}", e))?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("Failed to set size: {}", e))?;

    Ok(())
}
