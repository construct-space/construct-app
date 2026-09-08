//! macOS app menu construction and space-specific menu items.

use crate::config::app_display_name;

use std::io::Write;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

pub(crate) fn new_window_accelerator() -> &'static str {
    "CmdOrCtrl+N"
}

/// Show Developer Tools menu only in debug builds or when launched with
/// --dev (sets CONSTRUCT_DEV=1 in main.rs). Release users don't need it.
fn dev_mode() -> bool {
    cfg!(debug_assertions) || std::env::var("CONSTRUCT_DEV").as_deref() == Ok("1")
}

pub(crate) fn new_project_accelerator() -> &'static str {
    "CmdOrCtrl+Shift+N"
}

pub fn build_app_menu(
    app: &tauri::AppHandle,
    space: &str,
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let app_name = app_display_name();

    let mut app_menu_builder = SubmenuBuilder::new(app, app_name)
        .item(&MenuItemBuilder::with_id("about", format!("About {}", app_name)).build(app)?)
        .separator();

    app_menu_builder = app_menu_builder
        .item(&MenuItemBuilder::with_id("check_updates", "Check for Updates...").build(app)?)
        .separator();

    let app_menu = app_menu_builder
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new_construct_window", "New Construct Window")
                .accelerator(new_window_accelerator())
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("new_browser_window", "New Browser Window").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("new_project", "New Project")
                .accelerator(new_project_accelerator())
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open_project", "Open Project...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("save_as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let mut view_menu_builder = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_assistant", "Toggle Assistant")
                .accelerator("CmdOrCtrl+\\")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?);

    if dev_mode() {
        view_menu_builder = view_menu_builder.separator().item(
            &MenuItemBuilder::with_id("dev_tools", "Developer Tools")
                .accelerator("CmdOrCtrl+Alt+I")
                .build(app)?,
        );
    }

    match space {
        "code" => {
            view_menu_builder = view_menu_builder
                .separator()
                .item(
                    &MenuItemBuilder::with_id("toggle_terminal", "Toggle Terminal")
                        .accelerator("CmdOrCtrl+`")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("toggle_problems", "Toggle Problems")
                        .accelerator("CmdOrCtrl+Shift+M")
                        .build(app)?,
                );
        }
        "ui" => {
            view_menu_builder = view_menu_builder
                .separator()
                .item(
                    &MenuItemBuilder::with_id("zoom_in", "Zoom In")
                        .accelerator("CmdOrCtrl+=")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("zoom_out", "Zoom Out")
                        .accelerator("CmdOrCtrl+-")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("zoom_fit", "Zoom to Fit")
                        .accelerator("CmdOrCtrl+0")
                        .build(app)?,
                );
        }
        "kanban" => {
            view_menu_builder = view_menu_builder
                .separator()
                .item(&MenuItemBuilder::with_id("collapse_all", "Collapse All Columns").build(app)?)
                .item(&MenuItemBuilder::with_id("expand_all", "Expand All Columns").build(app)?);
        }
        _ => {}
    }

    let view_menu = view_menu_builder.build()?;

    let space_menu = match space {
        "code" => Some(
            SubmenuBuilder::new(app, "Code")
                .item(
                    &MenuItemBuilder::with_id("go_to_file", "Go to File...")
                        .accelerator("CmdOrCtrl+P")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("go_to_symbol", "Go to Symbol...")
                        .accelerator("CmdOrCtrl+Shift+O")
                        .build(app)?,
                )
                .separator()
                .item(
                    &MenuItemBuilder::with_id("find_in_files", "Find in Files...")
                        .accelerator("CmdOrCtrl+Shift+F")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("replace_in_files", "Replace in Files...")
                        .accelerator("CmdOrCtrl+Shift+H")
                        .build(app)?,
                )
                .separator()
                .item(
                    &MenuItemBuilder::with_id("format_document", "Format Document")
                        .accelerator("CmdOrCtrl+Shift+I")
                        .build(app)?,
                )
                .build()?,
        ),
        "ui" => Some(
            SubmenuBuilder::new(app, "Design")
                .item(
                    &MenuItemBuilder::with_id("add_frame", "Add Frame")
                        .accelerator("F")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("add_text", "Add Text")
                        .accelerator("T")
                        .build(app)?,
                )
                .item(
                    &MenuItemBuilder::with_id("add_rectangle", "Add Rectangle")
                        .accelerator("R")
                        .build(app)?,
                )
                .separator()
                .item(&MenuItemBuilder::with_id("align_left", "Align Left").build(app)?)
                .item(&MenuItemBuilder::with_id("align_center", "Align Center").build(app)?)
                .item(&MenuItemBuilder::with_id("align_right", "Align Right").build(app)?)
                .separator()
                .item(
                    &MenuItemBuilder::with_id("export_selection", "Export Selection...")
                        .accelerator("CmdOrCtrl+Shift+E")
                        .build(app)?,
                )
                .build()?,
        ),
        "kanban" => Some(
            SubmenuBuilder::new(app, "Board")
                .item(&MenuItemBuilder::with_id("new_column", "New Column").build(app)?)
                .item(
                    &MenuItemBuilder::with_id("new_card", "New Card")
                        .accelerator("CmdOrCtrl+Enter")
                        .build(app)?,
                )
                .separator()
                .item(
                    &MenuItemBuilder::with_id("filter_cards", "Filter Cards...")
                        .accelerator("CmdOrCtrl+F")
                        .build(app)?,
                )
                .build()?,
        ),
        _ => None,
    };

    let window_menu_builder = SubmenuBuilder::new(app, "Window")
        .item(
            &MenuItemBuilder::with_id("new_construct_window", "New Construct Window")
                .accelerator(new_window_accelerator())
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("new_browser_window", "New Browser Window").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("projects", "Projects")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        );

    let window_menu = window_menu_builder
        .separator()
        .item(
            &MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .build()?;

    let help_menu_builder_base = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("documentation", "Documentation").build(app)?)
        .item(
            &MenuItemBuilder::with_id("keyboard_shortcuts", "Keyboard Shortcuts")
                .accelerator("CmdOrCtrl+Shift+/")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("report_issue", "Report Issue...").build(app)?);

    let help_menu = help_menu_builder_base
        .item(&MenuItemBuilder::with_id("check_updates_help", "Check for Updates...").build(app)?)
        .build()?;

    let mut menu_builder = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu);

    if let Some(space_submenu) = space_menu {
        menu_builder = menu_builder.item(&space_submenu);
    }

    menu_builder.item(&window_menu).item(&help_menu).build()
}

/// A space menu item sent from the frontend (declared in space manifest).
#[derive(serde::Deserialize, Clone, Debug)]
pub struct SpaceMenuItem {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub accelerator: Option<String>,
    #[serde(default)]
    pub separator: bool,
}

/// A space menu group (the submenu label + items).
#[derive(serde::Deserialize, Clone, Debug)]
pub struct SpaceMenuDef {
    pub label: String,
    pub items: Vec<SpaceMenuItem>,
}

#[tauri::command]
pub fn set_app_menu(
    app: tauri::AppHandle,
    space: String,
    space_menu_def: Option<SpaceMenuDef>,
) -> Result<(), String> {
    let _ = write!(
        std::io::stderr(),
        "[Menu] Setting menu for space: {}\n",
        space
    );

    match build_app_menu_with_def(&app, &space, space_menu_def.as_ref()) {
        Ok(menu) => {
            if let Err(e) = app.set_menu(menu) {
                let _ = write!(std::io::stderr(), "[Menu] Failed to set menu: {}\n", e);
                return Err(format!("Failed to set menu: {}", e));
            }
            Ok(())
        }
        Err(e) => {
            let _ = write!(std::io::stderr(), "[Menu] Failed to build menu: {}\n", e);
            Err(format!("Failed to build menu: {}", e))
        }
    }
}

/// Build the app menu, using a dynamic space menu definition if provided,
/// falling back to hardcoded menus for legacy spaces.
fn build_app_menu_with_def(
    app: &tauri::AppHandle,
    space: &str,
    space_menu_def: Option<&SpaceMenuDef>,
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    // If frontend provided a menu definition, use it
    if let Some(def) = space_menu_def {
        return build_app_menu_dynamic(app, space, def);
    }
    // Otherwise use the hardcoded legacy menus
    build_app_menu(app, space)
}

/// Build app menu with a dynamic space submenu from manifest data.
fn build_app_menu_dynamic(
    app: &tauri::AppHandle,
    _space: &str,
    def: &SpaceMenuDef,
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let app_name = app_display_name();

    // Standard menus (same as build_app_menu)
    let app_menu = SubmenuBuilder::new(app, app_name)
        .item(&MenuItemBuilder::with_id("about", format!("About {}", app_name)).build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("check_updates", "Check for Updates...").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new_construct_window", "New Construct Window")
                .accelerator(new_window_accelerator())
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("new_browser_window", "New Browser Window").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("new_project", "New Project")
                .accelerator(new_project_accelerator())
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open_project", "Open Project...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("save_as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let mut view_menu_builder = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_assistant", "Toggle Assistant")
                .accelerator("CmdOrCtrl+\\")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?);

    if dev_mode() {
        view_menu_builder = view_menu_builder.separator().item(
            &MenuItemBuilder::with_id("dev_tools", "Developer Tools")
                .accelerator("CmdOrCtrl+Alt+I")
                .build(app)?,
        );
    }

    let view_menu = view_menu_builder.build()?;

    // Dynamic space submenu from manifest
    let mut space_submenu = SubmenuBuilder::new(app, &def.label);
    for item in &def.items {
        if item.separator {
            space_submenu = space_submenu.separator();
        } else {
            let mut builder = MenuItemBuilder::with_id(&item.id, &item.label);
            if let Some(ref accel) = item.accelerator {
                builder = builder.accelerator(accel);
            }
            space_submenu = space_submenu.item(&builder.build(app)?);
        }
    }
    let space_menu = space_submenu.build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(
            &MenuItemBuilder::with_id("new_construct_window", "New Construct Window")
                .accelerator(new_window_accelerator())
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("new_browser_window", "New Browser Window").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("projects", "Projects")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("documentation", "Documentation").build(app)?)
        .item(
            &MenuItemBuilder::with_id("keyboard_shortcuts", "Keyboard Shortcuts")
                .accelerator("CmdOrCtrl+Shift+/")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("report_issue", "Report Issue...").build(app)?)
        .item(&MenuItemBuilder::with_id("check_updates_help", "Check for Updates...").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&space_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

#[cfg(test)]
mod tests {
    use super::{new_project_accelerator, new_window_accelerator};

    #[test]
    fn new_window_uses_primary_shortcut() {
        assert_eq!(new_window_accelerator(), "CmdOrCtrl+N");
    }

    #[test]
    fn new_project_moves_off_primary_shortcut() {
        assert_eq!(new_project_accelerator(), "CmdOrCtrl+Shift+N");
    }
}
