//! Platform-specific UI: traffic lights, dock icon, color picker, vibrancy.

use std::process::Command;

// ==================== Traffic lights ====================

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn set_traffic_lights_visible(
    window: tauri::WebviewWindow,
    visible: bool,
) -> Result<(), String> {
    use objc2_app_kit::{NSWindow, NSWindowButton};

    let ns_window: *mut NSWindow =
        window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;

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
        "busy" => include_bytes!("../icons/dock-busy.png"),
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
    let bg = NSColor::colorWithSRGBRed_green_blue_alpha(
        24.0 / 255.0,
        24.0 / 255.0,
        27.0 / 255.0,
        1.0,
    );
    ns_window.setBackgroundColor(Some(&bg));
}
