//! Crash reporting from the Rust side.
//!
//! Panics in the desktop process are usually fatal and we can't make
//! a network call mid-crash anyway, so we serialize the panic to a
//! per-line JSON queue under `<base_dir>/desktop_panics.jsonl`. The
//! operator drains that queue on its next start and POSTs each entry
//! to telemetry-api `/api/errors`.
//!
//! Privacy: matches the rest of the telemetry pipeline. User paths in
//! the stack are normalized to `<HOME>` before write (the server does
//! it again as a defense in depth). Backtraces are bounded to a few KB.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::panic::{self, PanicHookInfo};
use std::path::PathBuf;
use std::sync::Once;
use std::time::{SystemTime, UNIX_EPOCH};

const QUEUE_FILE: &str = "desktop_panics.jsonl";
const MAX_STACK_LEN: usize = 4000;
const MAX_MESSAGE_LEN: usize = 500;

#[derive(Serialize)]
struct PanicRecord<'a> {
    occurred_at: String,
    severity: &'a str,
    error_class: &'a str,
    message: String,
    stack: String,
    app_version: &'a str,
    platform: &'a str,
    os_version: String,
    os_arch: &'a str,
}

/// Install the global panic hook. Idempotent — safe to call from the
/// Tauri builder. Falls through to whatever hook was previously
/// installed so dev-mode backtraces still print to stderr.
pub fn install(base_dir: PathBuf, app_version: &'static str) {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let prev_hook = panic::take_hook();
        panic::set_hook(Box::new(move |info: &PanicHookInfo<'_>| {
            // Best-effort write — never panic from inside the hook.
            let _ = write_record(&base_dir, app_version, info);
            // Preserve the existing hook so the user / dev still sees
            // the panic in stderr (and tests still report failures).
            prev_hook(info);
        }));
    });
}

fn write_record(
    base_dir: &PathBuf,
    app_version: &'static str,
    info: &PanicHookInfo<'_>,
) -> std::io::Result<()> {
    let payload = info.payload();
    let raw_msg = if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "panic".to_string()
    };

    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_default();

    let backtrace = std::backtrace::Backtrace::force_capture().to_string();
    let stack = sanitize_paths(&format!("{}\n--- backtrace ---\n{}", location, backtrace));

    let record = PanicRecord {
        occurred_at: rfc3339_now(),
        severity: "panic",
        error_class: "rust_panic",
        message: truncate(&raw_msg, MAX_MESSAGE_LEN),
        stack: truncate(&stack, MAX_STACK_LEN),
        app_version,
        platform: std::env::consts::OS,
        os_version: detect_os_version(),
        os_arch: std::env::consts::ARCH,
    };

    std::fs::create_dir_all(base_dir)?;
    let path = base_dir.join(QUEUE_FILE);

    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    let line = serde_json::to_string(&record).unwrap_or_else(|_| "{}".to_string());
    writeln!(file, "{}", line)?;
    Ok(())
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        // Slice on a UTF-8 boundary near the limit so we never split a code point.
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        s[..end].to_string()
    }
}

/// Replace per-OS user-home path prefixes with `<HOME>` so panic stacks
/// don't leak the developer/user's name. Mirrors the server-side
/// regexes in telemetry-api `sanitizeStack`.
fn sanitize_paths(s: &str) -> String {
    // /Users/<name>/...   /home/<name>/...   C:\Users\<name>\...   C:/Users/<name>/...
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let bytes = s.as_bytes();
    while i < bytes.len() {
        if try_replace(s, i, "/Users/", &mut out, &mut i) {
            continue;
        }
        if try_replace(s, i, "/home/", &mut out, &mut i) {
            continue;
        }
        if i + 9 <= bytes.len() {
            let chunk = &s[i..i + 9];
            // C:\Users\ or C:/Users/ — accept any drive letter
            if chunk.len() >= 9
                && bytes[i + 1] == b':'
                && (bytes[i + 2] == b'\\' || bytes[i + 2] == b'/')
                && bytes[i + 3..i + 8].eq_ignore_ascii_case(b"users")
                && (bytes[i + 8] == b'\\' || bytes[i + 8] == b'/')
                && bytes[i].is_ascii_alphabetic()
            {
                out.push_str("<HOME>");
                i += 9;
                while i < bytes.len()
                    && bytes[i] != b'\\'
                    && bytes[i] != b'/'
                    && !bytes[i].is_ascii_whitespace()
                {
                    i += 1;
                }
                continue;
            }
        }
        out.push(s[i..].chars().next().unwrap());
        i += s[i..].chars().next().unwrap().len_utf8();
    }
    out
}

fn try_replace(s: &str, i: usize, prefix: &str, out: &mut String, idx: &mut usize) -> bool {
    if !s[i..].starts_with(prefix) {
        return false;
    }
    out.push_str("<HOME>");
    let rest = &s[i + prefix.len()..];
    let stop = rest
        .find(|c: char| c == '/' || c == '\\' || c.is_whitespace())
        .unwrap_or(rest.len());
    *idx = i + prefix.len() + stop;
    true
}

/// RFC3339 formatter that doesn't pull in chrono. Uses
/// SystemTime + a fixed-format `YYYY-MM-DDTHH:MM:SSZ` representation
/// at second precision — fine for crash records.
fn rfc3339_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Days since epoch / time-of-day arithmetic — no leap second support
    // and no DST (we're emitting UTC).
    let days = secs.div_euclid(86_400);
    let tod = secs.rem_euclid(86_400);
    let (h, m, s) = (tod / 3600, (tod / 60) % 60, tod % 60);
    let (year, month, day) = days_to_ymd(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, h, m, s
    )
}

/// Convert days-since-Unix-epoch (1970-01-01) to (Y, M, D) using the
/// Howard Hinnant algorithm. Avoids pulling in chrono just to format
/// a timestamp string.
fn days_to_ymd(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

fn detect_os_version() -> String {
    // tauri-plugin-os exposes this from the renderer; from raw Rust we
    // only have what `std::env::consts` gives us. Fine — telemetry-api
    // treats os_version as optional and falls back to platform alone.
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_macos_user_path() {
        let cleaned = sanitize_paths("/Users/alice/code/app.rs:42");
        assert_eq!(cleaned, "<HOME>/code/app.rs:42");
    }

    #[test]
    fn sanitize_strips_linux_user_path() {
        let cleaned = sanitize_paths("/home/bob/project/main.rs");
        assert_eq!(cleaned, "<HOME>/project/main.rs");
    }

    #[test]
    fn sanitize_strips_windows_user_path() {
        let cleaned = sanitize_paths(r"C:\Users\carol\app\foo.rs");
        assert_eq!(cleaned, r"<HOME>\app\foo.rs");
    }

    #[test]
    fn truncate_respects_utf8_boundary() {
        // Two-byte char "ñ" at byte offset 2; truncating to 3 must back off to 2.
        let s = "abñcd";
        let t = truncate(s, 3);
        assert!(t.is_char_boundary(t.len()));
        assert_eq!(t, "ab");
    }
}
