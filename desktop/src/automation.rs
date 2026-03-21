//! Mouse move/click automation and accessibility permissions (macOS).

use crate::config::{optional_param_bool, optional_param_str, require_param_f64};

use std::time::Duration;

// ==================== macOS automation ====================

#[cfg(target_os = "macos")]
fn mouse_button_from_str(
    button: &str,
) -> Result<core_graphics::event::CGMouseButton, (String, String)> {
    use core_graphics::event::CGMouseButton;

    match button {
        "left" => Ok(CGMouseButton::Left),
        "right" => Ok(CGMouseButton::Right),
        "center" | "middle" => Ok(CGMouseButton::Center),
        _ => Err((
            "invalid_params".to_string(),
            format!("Unsupported mouse button: {}", button),
        )),
    }
}

#[cfg(target_os = "macos")]
fn mouse_event_types_for_button(
    button: core_graphics::event::CGMouseButton,
) -> (
    core_graphics::event::CGEventType,
    core_graphics::event::CGEventType,
) {
    use core_graphics::event::{CGEventType, CGMouseButton};

    match button {
        CGMouseButton::Left => (CGEventType::LeftMouseDown, CGEventType::LeftMouseUp),
        CGMouseButton::Right => (CGEventType::RightMouseDown, CGEventType::RightMouseUp),
        CGMouseButton::Center => (CGEventType::OtherMouseDown, CGEventType::OtherMouseUp),
    }
}

#[cfg(target_os = "macos")]
fn ensure_native_input_access() -> Result<(), (String, String)> {
    if check_accessibility_permission(false) {
        return Ok(());
    }

    let _ = check_accessibility_permission(true);
    if check_accessibility_permission(false) {
        return Ok(());
    }

    Err((
        "permission_denied".to_string(),
        "Construct needs macOS Accessibility access for native mouse control".to_string(),
    ))
}

#[cfg(target_os = "macos")]
fn point_for_construct_window(
    info: &crate::dev_instance::DevWindowInfo,
    params: &serde_json::Value,
) -> Result<core_graphics::geometry::CGPoint, (String, String)> {
    use core_graphics::geometry::CGPoint;

    let x = require_param_f64(params, "x")?;
    let y = require_param_f64(params, "y")?;
    let coordinate_space = optional_param_str(params, "coordinate_space").unwrap_or("window");

    let point = match coordinate_space {
        "screen" => CGPoint::new(x, y),
        "window" => CGPoint::new(info.bounds.x + x, info.bounds.y + y),
        _ => {
            return Err((
                "invalid_params".to_string(),
                format!("Unsupported coordinate_space: {}", coordinate_space),
            ))
        }
    };
    Ok(point)
}

#[cfg(target_os = "macos")]
fn post_mouse_move(point: core_graphics::geometry::CGPoint) -> Result<(), (String, String)> {
    use core_graphics::display::CGDisplay;
    use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventType, CGMouseButton};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let _ = CGDisplay::warp_mouse_cursor_position(point);
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| {
        (
            "internal".to_string(),
            "Failed to create mouse event source".to_string(),
        )
    })?;
    let event =
        CGEvent::new_mouse_event(source, CGEventType::MouseMoved, point, CGMouseButton::Left)
            .map_err(|_| {
                (
                    "internal".to_string(),
                    "Failed to create mouse move event".to_string(),
                )
            })?;
    event.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(target_os = "macos")]
async fn perform_construct_mouse_click(
    point: core_graphics::geometry::CGPoint,
    button: core_graphics::event::CGMouseButton,
    double_click: bool,
) -> Result<(), (String, String)> {
    use core_graphics::event::{CGEvent, CGEventTapLocation, EventField};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    post_mouse_move(point)?;

    let (down_type, up_type) = mouse_event_types_for_button(button);
    let click_count = if double_click { 2 } else { 1 };

    for click_index in 0..click_count {
        {
            let source =
                CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| {
                    (
                        "internal".to_string(),
                        "Failed to create mouse event source".to_string(),
                    )
                })?;
            let down =
                CGEvent::new_mouse_event(source, down_type, point, button).map_err(|_| {
                    (
                        "internal".to_string(),
                        "Failed to create mouse down event".to_string(),
                    )
                })?;
            down.set_integer_value_field(
                EventField::MOUSE_EVENT_CLICK_STATE,
                (click_index + 1) as i64,
            );
            down.post(CGEventTapLocation::HID);
        }

        tokio::time::sleep(Duration::from_millis(35)).await;

        {
            let source =
                CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| {
                    (
                        "internal".to_string(),
                        "Failed to create mouse event source".to_string(),
                    )
                })?;
            let up = CGEvent::new_mouse_event(source, up_type, point, button).map_err(|_| {
                (
                    "internal".to_string(),
                    "Failed to create mouse up event".to_string(),
                )
            })?;
            up.set_integer_value_field(
                EventField::MOUSE_EVENT_CLICK_STATE,
                (click_index + 1) as i64,
            );
            up.post(CGEventTapLocation::HID);
        }

        if double_click && click_index == 0 {
            tokio::time::sleep(Duration::from_millis(70)).await;
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn construct_mouse_move(
    params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    ensure_native_input_access()?;
    let route = optional_param_str(params, "route");
    let fresh = optional_param_bool(params, "fresh").unwrap_or(false);
    let info =
        crate::dev_instance::resolve_construct_dev_window(route, fresh, Duration::from_secs(15))
            .await?;
    let point = point_for_construct_window(&info, params)?;
    post_mouse_move(point)?;
    Ok(serde_json::json!({
        "status": "ok",
        "pid": info.pid,
        "window_id": info.window_id,
        "point": { "x": point.x, "y": point.y },
        "bounds": info.bounds.as_json(),
    }))
}

#[cfg(not(target_os = "macos"))]
pub async fn construct_mouse_move(
    _params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    Err((
        "not_implemented".to_string(),
        "Construct DEV mouse control is currently supported only on macOS".to_string(),
    ))
}

#[cfg(target_os = "macos")]
pub async fn construct_mouse_click(
    params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    ensure_native_input_access()?;
    let route = optional_param_str(params, "route");
    let fresh = optional_param_bool(params, "fresh").unwrap_or(false);
    let button = mouse_button_from_str(optional_param_str(params, "button").unwrap_or("left"))?;
    let double_click = optional_param_bool(params, "double").unwrap_or(false);
    let info =
        crate::dev_instance::resolve_construct_dev_window(route, fresh, Duration::from_secs(15))
            .await?;
    let point = point_for_construct_window(&info, params)?;
    perform_construct_mouse_click(point, button, double_click).await?;
    Ok(serde_json::json!({
        "status": "ok",
        "pid": info.pid,
        "window_id": info.window_id,
        "point": { "x": point.x, "y": point.y },
        "double": double_click,
        "bounds": info.bounds.as_json(),
    }))
}

#[cfg(not(target_os = "macos"))]
pub async fn construct_mouse_click(
    _params: &serde_json::Value,
) -> Result<serde_json::Value, (String, String)> {
    Err((
        "not_implemented".to_string(),
        "Construct DEV mouse control is currently supported only on macOS".to_string(),
    ))
}

// ==================== Accessibility permission ====================

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn check_accessibility_permission(prompt: bool) -> bool {
    use std::ffi::c_void;
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    }
    if prompt {
        unsafe {
            extern "C" {
                fn CFStringCreateWithCString(
                    alloc: *const c_void,
                    c_str: *const u8,
                    encoding: u32,
                ) -> *const c_void;
                fn CFDictionaryCreate(
                    allocator: *const c_void,
                    keys: *const *const c_void,
                    values: *const *const c_void,
                    num_values: isize,
                    key_callbacks: *const c_void,
                    value_callbacks: *const c_void,
                ) -> *const c_void;
                fn CFRelease(cf: *const c_void);
                static kCFTypeDictionaryKeyCallBacks: c_void;
                static kCFTypeDictionaryValueCallBacks: c_void;
                static kCFBooleanTrue: *const c_void;
            }
            let key = CFStringCreateWithCString(
                std::ptr::null(),
                b"AXTrustedCheckOptionPrompt\0".as_ptr(),
                0x08000100,
            );
            let keys = [key];
            let values = [kCFBooleanTrue as *const c_void];
            let options = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks as *const c_void,
                &kCFTypeDictionaryValueCallBacks as *const c_void,
            );
            let result = AXIsProcessTrustedWithOptions(options);
            CFRelease(options);
            CFRelease(key);
            result
        }
    } else {
        unsafe { AXIsProcessTrustedWithOptions(std::ptr::null()) }
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn check_accessibility_permission(_prompt: bool) -> bool {
    true
}
