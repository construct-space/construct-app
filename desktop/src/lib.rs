//! Construct desktop app — thin orchestrator.
//! Each concern lives in its own module; this file just wires them together.

mod automation;
mod biometric;
mod brain;
mod bridge;
mod browser;
mod browser_bridge;
mod check_deps;
pub mod config;
mod http_fetch;
mod local_alarms;
mod lsp;
mod menu;
mod notifications;
mod oauth;
mod panic_report;
mod path_env;
mod platform;
mod pty;
mod shell;
mod space_binary;
mod space_bundle;
mod space_screenshot;
#[cfg(feature = "voice")]
#[allow(dead_code)]
mod voice;
#[cfg(not(feature = "voice"))]
mod voice_stubs;

// Unified alias — resolves to real voice or stubs depending on feature
#[cfg(feature = "voice")]
use voice as voice_mod;
#[cfg(not(feature = "voice"))]
use voice_stubs as voice_mod;

use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// Devtools are always compiled in — the `devtools` feature is permanently
// enabled on the tauri dependency (see Cargo.toml). The host crate's
// own `devtools` feature flag was historically used to gate this command
// but it's redundant: tauri/devtools is always on, so the command always
// works. Cmd+Opt+I works in release builds too.
#[tauri::command]
fn open_devtools(app: tauri::AppHandle, label: String) -> Result<(), String> {
    eprintln!("[devtools] Opening for window: {}", label);
    if let Some(window) = app.get_webview_window(&label) {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
        Ok(())
    } else {
        Err(format!(
            "[devtools] Window '{}' not found, available: {:?}",
            label,
            app.webview_windows().keys().collect::<Vec<_>>()
        ))
    }
}

pub fn run() {
    // Patch PATH before anything else — operator, spaceprobe, shell tool, and
    // every other child process inherit our env, and the launchd default has
    // no Homebrew / user bins on it. See desktop/src/path_env.rs.
    path_env::augment();

    // Install the global panic hook now, before any feature init that
    // might panic. Crash reports get serialized to
    // <base_dir>/desktop_panics.jsonl; the operator drains the queue
    // and ships to telemetry-api on its next start. We use a fallback
    // tmp dir if the data directory can't be resolved (e.g. missing
    // HOME) so the hook can still log somewhere.
    if let Ok(base) = config::construct_data_dir() {
        panic_report::install(base, env!("CARGO_PKG_VERSION"));
    } else {
        panic_report::install(std::env::temp_dir(), env!("CARGO_PKG_VERSION"));
    }

    // Initialize all module states
    let brain_state = brain::new_state();
    let lsp_state = lsp::new_state();
    let browser_state = browser::new_state();
    let oauth_state = oauth::new_state();
    let process_state = shell::new_state();
    let pty_state = pty::new_state();
    let dock_open_state = pty::new_dock_state();
    let stt_state = voice_mod::stt::SttState::new();
    let tts_state = voice_mod::tts::TtsState::new();
    let playback_state = voice_mod::playback::PlaybackState::new();

    let builder = tauri::Builder::default()
        // Single-instance MUST be the first plugin. On Windows/Linux the browser's
        // construct:// redirect launches a NEW Construct.exe; this plugin forwards
        // the deep-link URL to the already-running instance (via the `deep-link`
        // feature flag) so OAuth callback lands in the window the user clicked
        // Login from, instead of spawning a second app. No-op on macOS (the OS
        // delivers deep links to the running app directly).
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            eprintln!("[single-instance] new invocation with argv: {argv:?}");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        // Core plugins
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_decorum::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("construct".into()),
                    }),
                ])
                // Compact format. The default prepends the log "target" — for
                // webview logs that's the full JS call site
                // (webview:fn@http://localhost:60200/…ts:line:col), which is
                // long and redundant since messages already self-label
                // (e.g. "[main] [bootstrapMain] start"). Keep date/time/level
                // + message only.
                .format(|out, message, record| {
                    let now = chrono::Local::now();
                    out.finish(format_args!(
                        "[{}][{}] {}",
                        now.format("%Y-%m-%d %H:%M:%S"),
                        record.level(),
                        message
                    ))
                })
                .level(log::LevelFilter::Info)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("sqlx::query", log::LevelFilter::Warn)
                .build(),
        );

    builder
        .manage(brain_state.clone())
        .manage(lsp_state)
        .manage(browser_state)
        .manage(oauth_state)
        .manage(process_state)
        .manage(pty_state)
        .manage(dock_open_state)
        .manage(stt_state)
        .manage(tts_state)
        .manage(playback_state)
        .manage(std::sync::Arc::new(notifications::NotificationsState::new()))
        .manage(std::sync::Arc::new(local_alarms::LocalAlarmState::new()))
        .setup(|app| {
            // Local alarm scheduler — rings notify-class scheduled tasks
            // natively even when the window is closed-to-tray and offline
            // (the frontend syncs the task set in via local_alarms_sync).
            local_alarms::start(app.handle().clone());

            // Reclaim disk from the old extract-to-disk era: installed spaces
            // are now read from their ZIP in memory, so the per-profile
            // `space-cache/` / `.space-cache/` dirs are stale. Best-effort,
            // off-thread so it never delays window creation.
            std::thread::spawn(space_bundle::cleanup_stale_caches);

            // Hardened notification stream — owns the WS to delivery-api so
            // it survives webview reloads / App Nap. Frontend pushes the
            // auth token in via `notifications_set_token`.
            {
                let state: tauri::State<std::sync::Arc<notifications::NotificationsState>> =
                    app.state();
                notifications::spawn(app.handle().clone(), (*state).clone());
            }

            // Register the construct:// scheme at runtime on Linux + Windows dev
            // builds. On macOS it comes from Info.plist. On Windows release the
            // NSIS installer writes registry keys, but register_all is idempotent
            // there too (and mandatory for dev / unpackaged runs).
            #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(err) = app.deep_link().register_all() {
                    eprintln!("[deep-link] register_all failed: {err:?}");
                }
            }

            // Set up initial menu
            if let Ok(m) = menu::build_app_menu(app.handle(), "default") {
                let _ = app.set_menu(m);
            }

            #[cfg(target_os = "macos")]
            platform::install_dock_menu(app.handle());

            // Apply vibrancy on macOS. We do NOT create decorum's overlay
            // title bar — the frontend renders its own TitleBar row with a
            // data-tauri-drag-region span, so the overlay would just sit
            // on top of everything and eat clicks (including the detach
            // button on the right). Traffic-light insets still come from
            // decorum because we want the buttons positioned for our row.
            #[cfg(target_os = "macos")]
            {
                use tauri_plugin_decorum::WebviewWindowExt;

                if let Some(window) = app.get_webview_window("main") {
                    platform::apply_window_vibrancy(&window);
                    let _ = window.set_traffic_lights_inset(10.0, 8.0);
                }
                if let Some(window) = app.get_webview_window("standalone-assistant") {
                    platform::apply_window_vibrancy(&window);
                    let _ = window.set_traffic_lights_inset(10.0, 8.0);
                }
            }

            // Windows/Linux: make the main window frameless so the frontend
            // TitleBar (with its own min/max/close controls) IS the chrome.
            // Resize borders for an undecorated *resizable* window are provided
            // by tao; the Windows-11 Snap-Layouts flyout is triggered from the
            // maximize button via decorum's `show_snap_overlay` command. macOS
            // keeps its native traffic lights + overlay title bar (above).
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
                if let Some(window) = app.get_webview_window("standalone-assistant") {
                    let _ = window.set_decorations(false);
                }
            }

            browser::install_event_listeners(app.handle());

            // Tray-resident mode — closing the main window hides it instead
            // of quitting, so the WS notification stream stays alive in the
            // background. Tray icon's "Show Construct" / "Quit" are the
            // explicit ways out of hidden state.
            install_tray(app.handle())?;

            // Start desktop bridge HTTP server
            let bridge_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                bridge::start_desktop_bridge(bridge_handle).await;
            });
            eprintln!(
                "[bridge] auth token initialized ({} bytes)",
                config::BRIDGE_TOKEN.len()
            );

            // Spawn brain sidecar synchronously so it's bound to the
            // operator port BEFORE the frontend's bootstrap calls
            // start_context_service. Async spawn raced with the first
            // invoke and operator.rs's "no existing service → launch
            // sidecar" fallback kicked in, undoing the swap. ensure_running
            // waits up to 5s for the TCP bind so we don't sit forever.
            let brain_handle: tauri::State<'_, brain::SharedBrainState> = app.state();
            match brain::ensure_running(&brain_handle) {
                Ok((tcp, http)) => {
                    eprintln!("[brain] up: tcp={} http={}", tcp, http);
                }
                Err(e) => {
                    eprintln!("[brain] spawn failed: {}", e);
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            handle_menu_action(app, event.id().as_ref());
        })
        // `space://localhost/<spaceId>/<entry>` — serves binary assets
        // (CSS-referenced images, fonts, etc.) straight from the installed
        // .space ZIP for the active profile. Text/metadata go over the
        // `space_zip_*` IPC commands instead. Async so a cold file read
        // doesn't block the scheme thread; never panics (404 on any error).
        .register_asynchronous_uri_scheme_protocol("space", |_ctx, request, responder| {
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(space_bundle::serve_space_request(&request));
            });
        })
        .invoke_handler(tauri::generate_handler![
            // Brain sidecar — spawned at startup (see setup closure).
            // Packaged builds proxy wire ops through Rust (brain_request /
            // brain_stream / brain_tool_response) because the secure
            // `tauri://` webview origin can't reach brain's plaintext loopback
            // HTTP directly. Browser dev still fetches HTTP+SSE on
            // brain_ports().http.
            brain::brain_ports,
            brain::brain_start,
            brain::brain_token,
            brain::brain_request,
            brain::brain_stream,
            brain::brain_tool_response,
            // Config
            config::get_construct_data_dir,
            config::get_data_dir,
            config::get_profile_data_dir,
            config::list_profiles,
            config::switch_profile,
            config::update_profile,
            config::create_profile,
            config::rename_profile,
            // Platform
            platform::set_traffic_lights_visible,
            platform::open_system_color_picker,
            platform::set_dock_icon,
            // LSP
            lsp::lsp_start_server,
            lsp::lsp_send_message,
            lsp::lsp_next_id,
            lsp::lsp_stop_server,
            lsp::lsp_stop_all,
            lsp::lsp_list_servers,
            lsp::lsp_check_command,
            lsp::lsp_install_server,
            lsp::lsp_detect_languages,
            // Browser
            browser::browser_open_host,
            browser::browser_eval_webview,
            browser::browser_build_init_script,
            browser::browser_create_webview,
            browser::browser_handle_popup,
            browser::browser_sync_state,
            browser::browser_set_zoom,
            browser::browser_devtools_toggle,
            open_devtools,
            // Hardened notification stream
            notifications::notifications_set_token,
            notifications::notifications_clear_token,
            notifications::notifications_debug_state,
            // OAuth
            oauth::oauth_start,
            oauth::oauth_get_pending,
            oauth::oauth_exchange,
            oauth::oauth_close_window,
            oauth::oauth_read_keychain,
            oauth::construct_auth_exchange_code,
            oauth::construct_auth_profile,
            oauth::codex_read_tokens,
            // Biometric unlock + keychain-backed session
            biometric::biometric_available,
            biometric::biometric_verify,
            biometric::construct_auth_save_tokens,
            biometric::construct_auth_load_tokens,
            biometric::construct_auth_clear_tokens,
            // Deps (onboarding)
            check_deps::check_deps,
            check_deps::install_bun,
            check_deps::install_construct,
            // Space bundles — read entries straight from the installed .space
            // ZIP (no on-disk extraction for the renderer).
            space_bundle::space_bundle_resolve,
            space_bundle::space_bundle_pack,
            space_bundle::space_bundle_validate,
            space_bundle::space_zip_list,
            space_bundle::space_zip_read_text,
            space_bundle::space_zip_read_bytes,
            space_bundle::space_zip_exists,
            space_bundle::space_zip_read_manifest,
            // Local alarm scheduler (offline/closed-window ring)
            local_alarms::local_alarms_sync,
            local_alarms::local_alarms_try_fire,
            // Space-shipped first-party tools (e.g. video-tools in video.space)
            space_binary::space_tool_invoke,
            space_binary::space_tool_resolve,
            // Shell
            shell::run_shell_command,
            shell::spawn_shell_command,
            shell::kill_shell_process,
            shell::send_process_input,
            shell::list_shell_processes,
            // PTY
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_list,
            pty::dock_set_listener_ready,
            // Menu
            menu::set_app_menu,
            trigger_menu_action,
            // Accessibility
            automation::check_accessibility_permission,
            // Bridge
            bridge::bridge_respond,
            // HTTP fetch (cross-origin)
            http_fetch::http_fetch,
            http_fetch::download_file,
            // Voice / STT
            voice_mod::stt::stt_init,
            voice_mod::stt::stt_transcribe,
            voice_mod::stt::stt_transcribe_segments,
            voice_mod::stt::stt_status,
            // Voice / TTS
            voice_mod::tts::tts_init,
            voice_mod::tts::tts_synthesize,
            voice_mod::tts::tts_set_voice,
            voice_mod::tts::tts_set_speed,
            voice_mod::tts::tts_status,
            voice_mod::tts::tts_voices,
            // Voice / Playback
            voice_mod::playback::playback_init,
            voice_mod::playback::playback_queue,
            voice_mod::playback::playback_stop,
            voice_mod::playback::playback_is_playing,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            // Brain runs as a sidecar; kill it when the parent app exits so
            // it doesn't outlive the UI in dev. Fires for both ExitRequested
            // (user-initiated, before exit) and Exit (after).
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(state) = app_handle.try_state::<brain::SharedBrainState>() {
                    brain::shutdown(&state);
                }
            }

            if let tauri::RunEvent::WindowEvent { label, event, .. } = &event {
                // Close-to-tray for the primary window: hide it, prevent
                // the close, and keep the process alive so the WS
                // notification stream + bridge server keep running. The
                // tray's "Quit Construct" is the explicit exit path.
                if label == "main" {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if let Some(win) = app_handle.get_webview_window("main") {
                            api.prevent_close();
                            let _ = win.hide();
                            return;
                        }
                    }
                }

                if should_exit_on_primary_window_close(
                    cfg!(target_os = "macos"),
                    label,
                    matches!(event, tauri::WindowEvent::CloseRequested { .. }),
                    has_other_webview_windows(app_handle, label),
                ) {
                    app_handle.exit(0);
                    return;
                }
            }

            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if path.is_dir() {
                            let folder_path = path.to_string_lossy().to_string();
                            eprintln!("[app] Folder dropped on dock: {}", folder_path);

                            let mut should_emit = true;
                            if let Some(state) = app_handle.try_state::<pty::SharedDockOpenState>()
                            {
                                if let Ok(mut dock_state) = state.lock() {
                                    if dock_state.listener_ready {
                                        should_emit = true;
                                    } else {
                                        should_emit = false;
                                        if !dock_state.pending_folders.contains(&folder_path) {
                                            dock_state.pending_folders.push(folder_path.clone());
                                        }
                                    }
                                }
                            }

                            if should_emit {
                                let _ = app_handle.emit("dock:open-folder", folder_path);
                            }
                        }
                    }
                }
            }
            if let tauri::RunEvent::ExitRequested { .. } = &event {
                safe_shutdown_cleanup(app_handle);
            }
            if matches!(event, tauri::RunEvent::Exit) {
                safe_shutdown_cleanup(app_handle);
            }
        });
}

fn new_main_window_label(seed: u128) -> String {
    format!("main-{}", seed)
}

fn new_main_window_webview_path() -> &'static str {
    "index.html"
}

/// Dispatch a menu action by its id. Single source of truth shared by the
/// native menu (`on_menu_event`) and the custom HTML menu bar on Windows/Linux
/// (`trigger_menu_action` command), so both behave identically.
///
/// Note: predefined edit items (undo/redo/cut/copy/paste/select_all),
/// window controls (minimize/maximize/close/fullscreen) and quit are handled
/// natively by the OS for the system menu and in the webview for the custom
/// bar — they never reach here.
fn handle_menu_action(app: &tauri::AppHandle, id: &str) {
    eprintln!("[Menu] Event: {}", id);

    match id {
        "new_window" | "new_construct_window" => {
            let _ = open_new_main_window(app);
        }
        "new_browser_window" => {
            browser::open_new_browser_tab(app.clone(), None, None, "menu");
        }
        "check_updates" | "check_updates_help" => {
            let _ = app.emit("menu:check-updates", ());
        }
        "about" => {
            let _ = app.emit("menu:about", ());
        }
        "new_project" => {
            let _ = app.emit("menu:new-project", ());
        }
        "open_project" => {
            let _ = app.emit("menu:open-project", ());
        }
        "save" => {
            let _ = app.emit("menu:save", ());
        }
        "save_as" => {
            let _ = app.emit("menu:save-as", ());
        }
        "toggle_sidebar" => {
            let _ = app.emit("menu:toggle-sidebar", ());
        }
        "toggle_assistant" => {
            let _ = app.emit("menu:toggle-assistant", ());
        }
        "toggle_terminal" => {
            let _ = app.emit("menu:toggle-terminal", ());
        }
        "toggle_problems" => {
            let _ = app.emit("menu:toggle-problems", ());
        }
        "zoom_in" => {
            let _ = app.emit("menu:zoom-in", ());
        }
        "zoom_out" => {
            let _ = app.emit("menu:zoom-out", ());
        }
        "zoom_fit" => {
            let _ = app.emit("menu:zoom-fit", ());
        }
        "go_to_file" => {
            let _ = app.emit("menu:go-to-file", ());
        }
        "go_to_symbol" => {
            let _ = app.emit("menu:go-to-symbol", ());
        }
        "find_in_files" => {
            let _ = app.emit("menu:find-in-files", ());
        }
        "replace_in_files" => {
            let _ = app.emit("menu:replace-in-files", ());
        }
        "format_document" => {
            let _ = app.emit("menu:format-document", ());
        }
        "add_frame" | "add_text" | "add_rectangle" => {
            let _ = app.emit(&format!("menu:{}", id.replace('_', "-")), ());
        }
        "export_selection" => {
            let _ = app.emit("menu:export-selection", ());
        }
        "new_column" | "new_card" | "filter_cards" => {
            let _ = app.emit(&format!("menu:{}", id.replace('_', "-")), ());
        }
        "dev_tools" => {
            #[cfg(any(debug_assertions, feature = "devtools"))]
            {
                eprintln!("[devtools] Menu triggered, opening on focused window");
                let target = app
                    .webview_windows()
                    .values()
                    .find(|w| w.is_focused().unwrap_or(false))
                    .cloned()
                    .or_else(|| app.get_webview_window("main"));
                if let Some(window) = target {
                    if window.is_devtools_open() {
                        window.close_devtools();
                    } else {
                        window.open_devtools();
                    }
                }
            }
        }
        "projects" => {
            let _ = app.emit("menu:projects", ());
        }
        "settings" => {
            let _ = app.emit("menu:settings", ());
        }
        "documentation" => {
            let _ = app
                .opener()
                .open_url("https://construct.space/learn", None::<&str>);
        }
        "keyboard_shortcuts" => {
            let _ = app.emit("menu:keyboard-shortcuts", ());
        }
        "report_issue" => {
            let _ = app.opener().open_url(
                "https://github.com/construct-space/construct-releases/issues",
                None::<&str>,
            );
        }
        other => {
            // Forward dynamic space menu events as a single generic event
            let _ = app.emit("menu:space-action", other);
        }
    }
}

/// Custom HTML menu bar (Windows/Linux) → run the same action the native menu
/// would. Edit/window/quit items are handled in the webview, so they never
/// invoke this.
#[tauri::command]
fn trigger_menu_action(app: tauri::AppHandle, id: String) {
    handle_menu_action(&app, &id);
}

fn open_new_main_window(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    let primary_main_exists = app.get_webview_window("main").is_some();
    let label = new_main_window_label(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    );
    let label = if primary_main_exists {
        label
    } else {
        "main".to_string()
    };

    let window = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(new_main_window_webview_path().into()),
    )
    .title("Construct")
    .inner_size(1440.0, 810.0)
    .min_inner_size(1024.0, 576.0)
    .resizable(true)
    .fullscreen(false);

    #[cfg(target_os = "macos")]
    let window = window
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // Windows/Linux: frameless — the frontend TitleBar is the chrome. See the
    // primary-window setup for rationale.
    #[cfg(not(target_os = "macos"))]
    let window = window.decorations(false);

    let window = window.build()?;

    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_decorum::WebviewWindowExt;

        platform::apply_window_vibrancy(&window);
        // Frontend renders its own TitleBar with a drag region; skip
        // decorum's overlay so it doesn't sit on top and absorb clicks.
        let _ = window.set_traffic_lights_inset(10.0, 8.0);
    }

    // --dev flag from main.rs (or CONSTRUCT_DEV=1 env): pop devtools open
    // automatically so prod builds can be inspected without rebuilding.
    if std::env::var("CONSTRUCT_DEV").as_deref() == Ok("1") {
        eprintln!(
            "[dev] CONSTRUCT_DEV=1 — opening devtools on '{}'",
            window.label()
        );
        window.open_devtools();
    }

    Ok(())
}

fn has_other_webview_windows(app: &tauri::AppHandle, closing_label: &str) -> bool {
    app.webview_windows()
        .keys()
        .any(|label| label.as_str() != closing_label)
}

// Builds the system tray icon and wires its menu + click events.
//
// Menu: "Show Construct" (focuses or recreates the main window) and
// "Quit Construct" (real exit, bypasses the close-to-hide intercept).
// Left-click on the tray icon does the same as "Show Construct".
fn install_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    // Disabled "label" item — gets its text rewritten by the status
    // poller below. Starts with a non-empty placeholder so the row
    // doesn't collapse before the first poll lands.
    let status_item = MenuItem::with_id(
        app,
        "tray_status",
        "Operator: checking…",
        false,
        None::<&str>,
    )?;
    // Restart only makes sense when the operator's down. The poller
    // below toggles `set_enabled` to grey it out when running.
    let restart_item =
        MenuItem::with_id(app, "tray_restart", "Restart Operator", false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let show_item = MenuItem::with_id(app, "tray_show", "Show Construct", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "tray_hide", "Hide Window", true, None::<&str>)?;
    // The "Quit" item is the only path that actually tears down the
    // tray — kept distinct from "Hide Window" so the user picks the
    // intent explicitly. Tray + operator both go down; operator was
    // detached at spawn so it CAN survive, but we kill it here on the
    // assumption that "Quit Construct" means "shut everything down".
    let quit_item = MenuItem::with_id(app, "tray_quit", "Quit Construct", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &restart_item,
            &separator,
            &show_item,
            &hide_item,
            &quit_item,
        ],
    )?;

    // Left-click opens the menu — matches the macOS menu-bar convention,
    // and gives the user the popover-style status row they expected.
    // The "Show Construct" item inside is the explicit way to bring the
    // window back.
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Construct")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => show_main_window(app),
            "tray_hide" => hide_main_window(app),
            "tray_quit" => {
                // Quit Construct = real shutdown. Take the operator
                // child down with us so the user never lands in the
                // confusing "no tray but brain still running" state.
                // To keep brain running while stepping away, close the
                // window with X (close-to-tray) instead of Quit.
                if let Some(state) = app.try_state::<brain::SharedBrainState>() {
                    brain::shutdown(&state);
                }
                app.exit(0);
            }
            "tray_restart" => {
                // The frontend has the auth context + the existing
                // `start_context_service` Tauri command, so we just
                // emit and let the Vue side invoke. Surface the
                // window first in case it was hidden — restart is
                // a deliberate action, the user wants to see it
                // happen.
                show_main_window(app);
                let _ = app.emit("tray:restart-operator", ());
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let tray = builder.build(app)?;

    // Status poller — checks the operator's TCP port every few
    // seconds and rewrites the disabled status row + tray tooltip.
    // Cheap (one localhost connect attempt) and gives the user a
    // visible "is the operator alive?" indicator at a glance. Also
    // toggles the Restart row's enabled state so it's only clickable
    // when the operator's actually down.
    let status_clone = status_item.clone();
    let restart_clone = restart_item.clone();
    std::thread::spawn(move || loop {
        let addr = config::operator_address();
        let connected = std::net::TcpStream::connect_timeout(
            &addr
                .parse()
                .unwrap_or_else(|_| std::net::SocketAddr::from(([127, 0, 0, 1], 60100))),
            std::time::Duration::from_millis(300),
        )
        .is_ok();
        let label = if connected {
            "Operator: 🟢 Running — waiting for requests"
        } else {
            "Operator: 🔴 Stopped — click Restart"
        };
        let _ = status_clone.set_text(label);
        let _ = restart_clone.set_enabled(!connected);
        let _ = tray.set_tooltip(Some(if connected {
            "Construct — operator running"
        } else {
            "Construct — operator stopped"
        }));
        std::thread::sleep(std::time::Duration::from_secs(5));
    });

    Ok(())
}

// Hides the main window without quitting. Same effect as the user
// clicking the close-to-tray X — useful as a tray-menu equivalent
// for keyboard-driven users who never use the mouse on the title bar.
fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

// Brings the primary window back to the foreground after a hide-to-tray.
// If "main" was destroyed (rare — Tauri keeps it around when hidden), we
// fall back to creating a new main window via the existing helper.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    } else {
        let _ = open_new_main_window(app);
    }
}

fn should_exit_on_primary_window_close(
    is_macos: bool,
    label: &str,
    is_close_requested: bool,
    has_other_windows: bool,
) -> bool {
    label == "main" && is_close_requested && !has_other_windows && !is_macos
}

fn perform_shutdown_cleanup(app_handle: &tauri::AppHandle) {
    eprintln!("[app] Shutdown cleanup starting...");

    // Phase 1 of operator-as-daemon: leave the operator process alive
    // when the desktop UI quits so cross-device commands (mobile →
    // delivery-api → operator) can land even when nobody has the
    // desktop window open. The operator no longer self-terminates
    if let Some(lsp) = app_handle.try_state::<lsp::SharedLspState>() {
        lsp::shutdown_servers(&lsp);
    }

    if let Some(procs) = app_handle.try_state::<shell::SharedProcessState>() {
        shell::shutdown_processes(&procs);
    }

    if let Some(pty) = app_handle.try_state::<pty::SharedPtyState>() {
        pty::shutdown_sessions(&pty);
    }

    eprintln!("[app] Cleanup complete");
}

fn safe_shutdown_cleanup(app_handle: &tauri::AppHandle) {
    if config::SHUTDOWN_CLEANUP_RAN.swap(true, Ordering::Relaxed) {
        return;
    }

    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        perform_shutdown_cleanup(app_handle);
    }))
    .is_err()
    {
        eprintln!("[app] Shutdown cleanup panicked; suppressing panic during app termination");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        new_main_window_label, new_main_window_webview_path, should_exit_on_primary_window_close,
    };

    #[test]
    fn main_window_close_requests_exit() {
        assert!(should_exit_on_primary_window_close(
            false, "main", true, false
        ));
    }

    #[test]
    fn secondary_window_close_does_not_exit() {
        assert!(!should_exit_on_primary_window_close(
            false,
            "standalone-assistant",
            true,
            false,
        ));
    }

    #[test]
    fn non_close_events_do_not_exit() {
        assert!(!should_exit_on_primary_window_close(
            false, "main", false, false
        ));
    }

    #[test]
    fn macos_main_window_close_keeps_app_running() {
        assert!(!should_exit_on_primary_window_close(
            true, "main", true, false
        ));
    }

    #[test]
    fn main_window_close_with_other_windows_keeps_app_running() {
        assert!(!should_exit_on_primary_window_close(
            false, "main", true, true
        ));
    }

    #[test]
    fn new_main_window_uses_distinct_main_label() {
        assert_eq!(new_main_window_label(42), "main-42");
    }

    #[test]
    fn new_main_window_loads_app_shell() {
        assert_eq!(new_main_window_webview_path(), "index.html");
    }
}
