//! Construct desktop app — thin orchestrator.
//! Each concern lives in its own module; this file just wires them together.

mod automation;
mod bridge;
mod browser;
mod browser_bridge;
pub mod config;
mod dev_instance;
mod lsp;
mod menu;
mod oauth;
mod operator;
mod platform;
mod pty;
mod shell;

use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize all module states
    let context_state = operator::new_state();
    let lsp_state = lsp::new_state();
    let browser_state = browser::new_state();
    let oauth_state = oauth::new_state();
    let process_state = shell::new_state();
    let pty_state = pty::new_state();
    let dock_open_state = pty::new_dock_state();

    let builder = tauri::Builder::default()
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("construct".into()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("sqlx::query", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        );

    builder
        .manage(context_state)
        .manage(lsp_state)
        .manage(browser_state)
        .manage(oauth_state)
        .manage(process_state)
        .manage(pty_state)
        .manage(dock_open_state)
        .setup(|app| {
            // Set up initial menu
            if let Ok(m) = menu::build_app_menu(app.handle(), "default") {
                let _ = app.set_menu(m);
            }

            // Override title for dev instances
            if config::is_dev_instance() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title(config::app_display_name());
                }
                #[cfg(target_os = "macos")]
                {
                    use objc2::MainThreadMarker;
                    use objc2_app_kit::NSApplication;
                    unsafe {
                        let mtm = MainThreadMarker::new_unchecked();
                        let ns_app = NSApplication::sharedApplication(mtm);
                        if let Some(main_menu) = ns_app.mainMenu() {
                            if let Some(app_menu_item) = main_menu.itemAtIndex(0) {
                                if let Some(submenu) = app_menu_item.submenu() {
                                    let title = objc2_foundation::NSString::from_str(
                                        config::app_display_name(),
                                    );
                                    submenu.setTitle(&title);
                                    app_menu_item.setTitle(&title);
                                }
                            }
                        }
                    }
                }
            }

            // Apply vibrancy on macOS
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    platform::apply_window_vibrancy(&window);
                }
                if let Some(window) = app.get_webview_window("standalone-assistant") {
                    platform::apply_window_vibrancy(&window);
                }
            }

            // Start desktop bridge HTTP server
            let bridge_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                bridge::start_desktop_bridge(bridge_handle).await;
            });
            eprintln!(
                "[bridge] token: {} (first 8 chars: {}...)",
                config::BRIDGE_TOKEN.len(),
                &config::BRIDGE_TOKEN[..8]
            );

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            eprintln!("[Menu] Event: {}", id);

            match id {
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
                "projects" => {
                    let _ = app.emit("menu:projects", ());
                }
                "settings" => {
                    let _ = app.emit("menu:settings", ());
                }
                "documentation" => {
                    let _ = app
                        .opener()
                        .open_url("https://construct.space/docs", None::<&str>);
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
                "open_construct_dev" => {
                    let _ = dev_instance::open_construct_dev();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Operator / context
            operator::start_context_service,
            operator::connect_context,
            operator::is_connected,
            operator::send_context_request,
            operator::context_get,
            operator::context_set_mode,
            operator::context_set_component,
            operator::context_set_project,
            operator::context_set_selection,
            operator::context_ping,
            operator::list_models,
            operator::list_providers,
            operator::list_agents,
            operator::chat_direct,
            operator::chat_stream,
            operator::architect_stream,
            operator::vibe_stream,
            operator::operator_stream,
            operator::operator_stop_stream,
            operator::vision_analyze,
            // Config
            config::get_construct_data_dir,
            config::get_is_dev_instance,
            config::get_data_dir,
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
            browser::browser_create_tab,
            browser::browser_close_tab,
            browser::browser_navigate,
            browser::browser_set_tab_visible,
            browser::browser_reload,
            browser::browser_get_url,
            browser::browser_toggle_devtools,
            browser::browser_close_all,
            browser::browser_open_standalone,
            browser::browser_go_back,
            browser::browser_go_forward,
            browser::browser_set_tab_bounds,
            // OAuth
            oauth::oauth_start,
            oauth::oauth_get_pending,
            oauth::oauth_exchange,
            oauth::oauth_close_window,
            oauth::oauth_read_keychain,
            oauth::construct_auth_exchange_code,
            oauth::construct_auth_profile,
            oauth::codex_read_tokens,
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
            // DEV instance
            dev_instance::open_construct_dev,
            dev_instance::open_construct_dev_route,
            dev_instance::get_launch_route,
            // Accessibility
            automation::check_accessibility_permission,
            // Bridge
            bridge::bridge_respond,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if path.is_dir() {
                            let folder_path = path.to_string_lossy().to_string();
                            eprintln!("[app] Folder dropped on dock: {}", folder_path);

                            let mut should_emit = true;
                            if let Some(state) =
                                app_handle.try_state::<pty::SharedDockOpenState>()
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

fn perform_shutdown_cleanup(app_handle: &tauri::AppHandle) {
    eprintln!("[app] Shutdown cleanup starting...");

    if let Some(ctx_state) = app_handle.try_state::<operator::SharedContextState>() {
        operator::shutdown(&ctx_state);
    }

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
