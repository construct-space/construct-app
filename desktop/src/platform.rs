//! Platform-specific UI: traffic lights, dock icon, color picker, vibrancy.

#[cfg(target_os = "macos")]
use crate::config;

#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
use std::sync::OnceLock;

#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg(target_os = "macos")]
static DOCK_MENU_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

#[cfg(target_os = "macos")]
const DOCK_ACTION_NEW_BROWSER_TAG: isize = 1;

#[cfg(target_os = "macos")]
const DOCK_PROFILE_TAG_BASE: isize = 10_000;

#[cfg(target_os = "macos")]
const DOCK_MENU_SWITCH_PROFILE_EVENT: &str = "menu:switch-profile";

// ==================== Traffic lights ====================

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn set_traffic_lights_visible(
    window: tauri::WebviewWindow,
    visible: bool,
) -> Result<(), String> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let ns_window: *mut NSWindow = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;

    unsafe {
        let ns_window = &*ns_window;

        if let Some(close_button) = ns_window.standardWindowButton(NSWindowButton::CloseButton) {
            close_button.setHidden(!visible);
        }
        if let Some(miniaturize_button) =
            ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)
        {
            miniaturize_button.setHidden(!visible);
        }
        if let Some(zoom_button) = ns_window.standardWindowButton(NSWindowButton::ZoomButton) {
            zoom_button.setHidden(!visible);
        }
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn set_traffic_lights_visible(_visible: bool) -> Result<(), String> {
    Ok(())
}

// ==================== Dock icon ====================

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn set_dock_icon(_app: tauri::AppHandle, state: String) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_app_kit::NSApplication;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSData;

    let icon_bytes: &[u8] = match state.as_str() {
        "dev" => include_bytes!("../icons/dock-dev.png"),
        "beta" => include_bytes!("../icons/dock-beta.png"),
        "update" => include_bytes!("../icons/dock-update.png"),
        "error" => include_bytes!("../icons/dock-error.png"),
        "busy" => include_bytes!("../icons/dock-error.png"),
        _ => include_bytes!("../icons/icon.png"),
    };

    unsafe {
        let mtm = objc2::MainThreadMarker::new_unchecked();
        let data = NSData::with_bytes(icon_bytes);
        let image: Retained<NSImage> = NSImage::initWithData(NSImage::alloc(), &data)
            .ok_or("Failed to create NSImage from icon data")?;
        let ns_app = NSApplication::sharedApplication(mtm);
        ns_app.setApplicationIconImage(Some(&image));
    }

    eprintln!("[dock] Icon state set to: {}", state);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn set_dock_icon(_state: String) -> Result<(), String> {
    Ok(())
}

// ==================== Dock menu ====================

#[cfg(target_os = "macos")]
pub fn install_dock_menu(app: &tauri::AppHandle) {
    use std::mem::transmute;

    use objc2::ffi::class_addMethod;
    use objc2::runtime::{AnyObject, Imp};
    use objc2::{sel, MainThreadMarker};
    use objc2_app_kit::NSApplication;

    let _ = DOCK_MENU_APP.set(app.clone());

    unsafe {
        let mtm = MainThreadMarker::new_unchecked();
        let ns_app = NSApplication::sharedApplication(mtm);
        let Some(delegate) = ns_app.delegate() else {
            eprintln!("[dock] NSApplication delegate unavailable");
            return;
        };

        let delegate_obj: &AnyObject = delegate.as_ref();
        let delegate_class = delegate_obj.class();
        if delegate_class.responds_to(sel!(applicationDockMenu:)) {
            return;
        }

        let added_menu = class_addMethod(
            delegate_class as *const _ as *mut _,
            sel!(applicationDockMenu:),
            transmute::<
                unsafe extern "C-unwind" fn(
                    &AnyObject,
                    objc2::runtime::Sel,
                    &NSApplication,
                ) -> *mut objc2_app_kit::NSMenu,
                Imp,
            >(dock_menu_for_application),
            c"@@:@".as_ptr(),
        );
        let added_action = class_addMethod(
            delegate_class as *const _ as *mut _,
            sel!(constructHandleDockMenuAction:),
            transmute::<
                unsafe extern "C-unwind" fn(
                    &AnyObject,
                    objc2::runtime::Sel,
                    &objc2_app_kit::NSMenuItem,
                ),
                Imp,
            >(handle_dock_menu_action),
            c"v@:@".as_ptr(),
        );

        if !added_menu.as_bool() || !added_action.as_bool() {
            eprintln!("[dock] Failed to install Dock menu methods on app delegate");
        }
    }
}

// No non-macOS stub: the only call site (lib.rs) is itself
// #[cfg(target_os = "macos")]-gated, so a stub would be dead code on
// other platforms.

#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn dock_menu_for_application(
    this: &objc2::runtime::AnyObject,
    _: objc2::runtime::Sel,
    _: &objc2_app_kit::NSApplication,
) -> *mut objc2_app_kit::NSMenu {
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2::MainThreadOnly;
    use objc2_app_kit::{NSControlStateValueOff, NSControlStateValueOn, NSMenu, NSMenuItem};
    use objc2_foundation::NSString;

    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str("Construct"));

    let browser_item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &NSString::from_str("New Browser"),
            Some(objc2::sel!(constructHandleDockMenuAction:)),
            &NSString::from_str(""),
        )
    };
    browser_item.setTag(DOCK_ACTION_NEW_BROWSER_TAG);
    unsafe {
        browser_item.setTarget(Some(this));
    }
    menu.addItem(&browser_item);
    menu.addItem(&NSMenuItem::separatorItem(mtm));

    let header = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &NSString::from_str("Profiles"),
            None,
            &NSString::from_str(""),
        )
    };
    header.setEnabled(false);
    menu.addItem(&header);

    match config::profile_menu_entries() {
        Ok((active_profile_id, profiles)) if !profiles.is_empty() => {
            for (index, profile) in profiles.iter().enumerate() {
                let item = unsafe {
                    NSMenuItem::initWithTitle_action_keyEquivalent(
                        NSMenuItem::alloc(mtm),
                        &NSString::from_str(&profile.name),
                        Some(objc2::sel!(constructHandleDockMenuAction:)),
                        &NSString::from_str(""),
                    )
                };
                item.setTag(DOCK_PROFILE_TAG_BASE + index as isize);
                item.setState(if profile.id == active_profile_id {
                    NSControlStateValueOn
                } else {
                    NSControlStateValueOff
                });
                item.setEnabled(profile.id != active_profile_id);
                if let Some(email) = profile.email.as_deref() {
                    item.setSubtitle(Some(&NSString::from_str(email)));
                }
                unsafe {
                    item.setTarget(Some(this));
                }
                menu.addItem(&item);
            }
        }
        _ => {
            let empty = unsafe {
                NSMenuItem::initWithTitle_action_keyEquivalent(
                    NSMenuItem::alloc(mtm),
                    &NSString::from_str("No profiles yet"),
                    None,
                    &NSString::from_str(""),
                )
            };
            empty.setEnabled(false);
            menu.addItem(&empty);
        }
    }

    Retained::autorelease_return(menu)
}

#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn handle_dock_menu_action(
    _: &objc2::runtime::AnyObject,
    _: objc2::runtime::Sel,
    sender: &objc2_app_kit::NSMenuItem,
) {
    let tag = sender.tag();
    if tag == DOCK_ACTION_NEW_BROWSER_TAG {
        let Some(app) = DOCK_MENU_APP.get().cloned() else {
            eprintln!("[dock] Missing app handle for New Browser action");
            return;
        };

        crate::browser::open_new_browser_tab(app, None, None, "dock");
        return;
    }
    if tag < DOCK_PROFILE_TAG_BASE {
        return;
    }

    let profile_index = (tag - DOCK_PROFILE_TAG_BASE) as usize;
    let Ok((_, profiles)) = config::profile_menu_entries() else {
        eprintln!("[dock] Failed to load profiles for Dock menu action");
        return;
    };
    let Some(profile) = profiles.get(profile_index) else {
        eprintln!("[dock] Invalid profile Dock menu index: {}", profile_index);
        return;
    };

    if let Err(error) = config::switch_profile(profile.id.clone()) {
        eprintln!(
            "[dock] Failed to switch profile '{}': {}",
            profile.id, error
        );
        return;
    }

    if let Some(app) = DOCK_MENU_APP.get() {
        let _ = app.emit(DOCK_MENU_SWITCH_PROFILE_EVENT, profile.id.clone());
    }
}

// ==================== Color picker ====================

#[cfg(target_os = "macos")]
fn hex_to_rgb16(hex: &str) -> Option<(u16, u16, u16)> {
    let value = hex.trim().strip_prefix('#').unwrap_or(hex.trim());
    let expanded = if value.len() == 3 {
        let mut out = String::with_capacity(6);
        for ch in value.chars() {
            out.push(ch);
            out.push(ch);
        }
        out
    } else if value.len() == 6 {
        value.to_string()
    } else {
        return None;
    };

    let r8 = u8::from_str_radix(&expanded[0..2], 16).ok()?;
    let g8 = u8::from_str_radix(&expanded[2..4], 16).ok()?;
    let b8 = u8::from_str_radix(&expanded[4..6], 16).ok()?;

    Some((
        u16::from(r8) * 257,
        u16::from(g8) * 257,
        u16::from(b8) * 257,
    ))
}

#[cfg(target_os = "macos")]
fn rgb16_to_hex(r16: u16, g16: u16, b16: u16) -> String {
    let r8 = ((u32::from(r16) + 128) / 257) as u8;
    let g8 = ((u32::from(g16) + 128) / 257) as u8;
    let b8 = ((u32::from(b16) + 128) / 257) as u8;
    format!("#{:02X}{:02X}{:02X}", r8, g8, b8)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_system_color_picker(initial_hex: Option<String>) -> Result<Option<String>, String> {
    let default_clause = initial_hex
        .as_deref()
        .and_then(hex_to_rgb16)
        .map(|(r, g, b)| format!(" default color {{{}, {}, {}}}", r, g, b))
        .unwrap_or_default();

    let script = format!("choose color{}", default_clause);
    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to launch macOS color picker: {}", e))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout =
        String::from_utf8(output.stdout).map_err(|e| format!("Invalid picker response: {}", e))?;
    let parts: Vec<&str> = stdout.trim().split(',').collect();
    if parts.len() < 3 {
        return Err("Unexpected color picker response".to_string());
    }

    let r16 = parts[0]
        .trim()
        .parse::<u16>()
        .map_err(|_| "Invalid red channel from color picker".to_string())?;
    let g16 = parts[1]
        .trim()
        .parse::<u16>()
        .map_err(|_| "Invalid green channel from color picker".to_string())?;
    let b16 = parts[2]
        .trim()
        .parse::<u16>()
        .map_err(|_| "Invalid blue channel from color picker".to_string())?;

    Ok(Some(rgb16_to_hex(r16, g16, b16)))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn open_system_color_picker(_initial_hex: Option<String>) -> Result<Option<String>, String> {
    Ok(None)
}

// ==================== Window vibrancy (setup helper) ====================

/// Apply macOS vibrancy and background color to a webview window.
#[cfg(target_os = "macos")]
pub fn apply_window_vibrancy(window: &tauri::WebviewWindow) {
    use window_vibrancy::apply_vibrancy;
    let _ = apply_vibrancy(
        window,
        window_vibrancy::NSVisualEffectMaterial::Sidebar,
        None,
        Some(26.0),
    );

    use objc2_app_kit::{NSColor, NSWindow};
    let ns_window = window.ns_window().unwrap();
    let ns_window = unsafe { &*(ns_window as *const NSWindow) };
    let bg =
        NSColor::colorWithSRGBRed_green_blue_alpha(24.0 / 255.0, 24.0 / 255.0, 27.0 / 255.0, 1.0);
    ns_window.setBackgroundColor(Some(&bg));
}
